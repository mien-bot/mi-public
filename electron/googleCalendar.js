const crypto = require("node:crypto");
const http = require("node:http");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_ROOT = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
/** Asked for only when someone chooses to send. Viewing stays read-only. */
const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

const base64Url = (bytes) => Buffer.from(bytes).toString("base64url");

/** Errors stay generic: a Google response can echo request details, and tokens must never surface. */
async function googleRequest(fetchImpl, url, init, action) {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw new Error(`Google could not ${action} (status ${response.status}).`);
  return response.json();
}

function buildAuthUrl({ clientId, redirectUri, state, challenge, write = false }) {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: write ? `${SCOPE} ${WRITE_SCOPE}` : SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return url.toString();
}

/** Waits for one redirect to a loopback address, then closes. The browser never sees a token. */
function awaitRedirect({ state, timeoutMs, onListening }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname !== "/callback") { response.writeHead(404).end(); return; }
      const valid = url.searchParams.get("state") === state;
      const code = valid ? url.searchParams.get("code") : null;
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(code ? "Google Calendar is connected. You can close this tab and return to Mi." : "Mi could not connect. You can close this tab and try again in Mi.");
      finish(code ? null : new Error(valid ? "Google sign-in was cancelled." : "The sign-in response did not match this request."), code);
    });
    const timer = setTimeout(() => finish(new Error("Google sign-in timed out.")), timeoutMs);
    function finish(error, code) {
      clearTimeout(timer);
      server.close();
      if (error) reject(error); else resolve(code);
    }
    server.on("error", (error) => finish(error));
    server.listen(0, "127.0.0.1", () => {
      Promise.resolve(onListening(`http://127.0.0.1:${server.address().port}/callback`)).catch((error) => finish(error));
    });
  });
}

/** Sign-in in the system browser with PKCE. Returns the refresh token for the caller to encrypt. */
async function signIn({ clientId, clientSecret, openExternal, write = false, fetchImpl = fetch, timeoutMs = SIGN_IN_TIMEOUT_MS }) {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64Url(crypto.randomBytes(24));
  let redirectUri = "";
  const code = await awaitRedirect({
    state,
    timeoutMs,
    onListening: (uri) => { redirectUri = uri; return openExternal(buildAuthUrl({ clientId, redirectUri: uri, state, challenge, write })); },
  });
  const tokens = await googleRequest(fetchImpl, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }).toString(),
  }, "finish sign-in");
  if (!tokens.refresh_token) throw new Error("Google did not return a lasting sign-in. Remove Mi from your Google account's connected apps and try again.");
  // Google lets a person untick a permission on its consent screen.
  if (write && typeof tokens.scope === "string" && !tokens.scope.split(" ").includes(WRITE_SCOPE)) {
    throw new Error("Google did not grant permission to add events. Sign in again and leave that permission ticked.");
  }
  return tokens.refresh_token;
}

async function accessToken({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  const tokens = await googleRequest(fetchImpl, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  }, "refresh the connection");
  return tokens.access_token;
}

async function listCalendars({ token, fetchImpl = fetch }) {
  const data = await googleRequest(fetchImpl, `${API_ROOT}/users/me/calendarList`, { headers: { Authorization: `Bearer ${token}` } }, "list calendars");
  return (data.items ?? []).map((item) => ({ id: String(item.id), name: String(item.summaryOverride || item.summary || item.id), accessRole: String(item.accessRole ?? "") }));
}

async function listEvents({ token, calendarId, from, to, fetchImpl = fetch }) {
  const events = [];
  let pageToken;
  do {
    const url = new URL(`${API_ROOT}/calendars/${encodeURIComponent(calendarId)}/events`);
    url.search = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      timeMin: `${from}T00:00:00Z`,
      timeMax: `${to}T23:59:59Z`,
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const data = await googleRequest(fetchImpl, url.toString(), { headers: { Authorization: `Bearer ${token}` } }, "read calendar events");
    for (const item of data.items ?? []) {
      // Mi's own events are already on the calendar from STUDIO Schedule.
      if (item.status === "cancelled" || isManaged(item)) continue;
      events.push({
        id: String(item.id),
        name: String(item.summary || "Busy"),
        date: item.start?.dateTime ?? item.start?.date ?? null,
        date_end: item.start?.dateTime ? item.end?.dateTime ?? null : null,
        url: typeof item.htmlLink === "string" ? item.htmlLink : null,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return events;
}

const isManaged = (item) => item?.extendedProperties?.private?.miManaged === "1";
const eventUrl = (calendarId, id = "") => `${API_ROOT}/calendars/${encodeURIComponent(calendarId)}/events${id ? `/${encodeURIComponent(id)}` : ""}`;
const jsonHeaders = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

/** Asks Google only for tagged events, so a person's own events are never in the working set. */
async function listManagedEvents({ token, calendarId, fetchImpl = fetch }) {
  const events = [];
  let pageToken;
  do {
    const url = new URL(eventUrl(calendarId));
    url.search = new URLSearchParams({
      privateExtendedProperty: "miManaged=1",
      singleEvents: "true",
      maxResults: "2500",
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const data = await googleRequest(fetchImpl, url.toString(), { headers: { Authorization: `Bearer ${token}` } }, "read Mi's events");
    for (const item of data.items ?? []) {
      if (item.status === "cancelled" || !isManaged(item)) continue;
      events.push({
        id: String(item.id),
        source: String(item.extendedProperties.private.miSource ?? ""),
        hash: String(item.extendedProperties.private.miHash ?? ""),
        name: String(item.summary || "Untitled"),
        when: String(item.start?.dateTime ?? item.start?.date ?? ""),
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return events;
}

/** Every change re-reads the event first, so nothing untagged can be touched by any path. */
async function requireManaged({ token, calendarId, id, fetchImpl }) {
  const response = await fetchImpl(eventUrl(calendarId, id), { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 404 || response.status === 410) return false;
  if (!response.ok) throw new Error(`Google could not read this event (status ${response.status}).`);
  if (!isManaged(await response.json())) throw new Error("Mi did not add this event, so it left it alone.");
  return true;
}

async function updateManagedEvent({ token, calendarId, id, event, fetchImpl = fetch }) {
  if (!await requireManaged({ token, calendarId, id, fetchImpl })) throw new Error("This event is no longer in Google Calendar. Preview again.");
  await googleRequest(fetchImpl, eventUrl(calendarId, id), { method: "PUT", headers: jsonHeaders(token), body: JSON.stringify({ ...event, status: "confirmed" }) }, "update this event");
}

/** A 409 means this id already exists, which only Mi can have made. A retry adopts it. */
async function insertEvent({ token, calendarId, id, event, fetchImpl = fetch }) {
  const url = new URL(eventUrl(calendarId));
  url.search = new URLSearchParams({ sendUpdates: "none" }).toString();
  const response = await fetchImpl(url.toString(), { method: "POST", headers: jsonHeaders(token), body: JSON.stringify({ ...event, id }) });
  if (response.status === 409) return updateManagedEvent({ token, calendarId, id, event, fetchImpl });
  if (!response.ok) throw new Error(`Google could not add this event (status ${response.status}).`);
  return undefined;
}

async function deleteManagedEvent({ token, calendarId, id, fetchImpl = fetch }) {
  if (!await requireManaged({ token, calendarId, id, fetchImpl })) return;
  const url = new URL(eventUrl(calendarId, id));
  url.search = new URLSearchParams({ sendUpdates: "none" }).toString();
  const response = await fetchImpl(url.toString(), { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error(`Google could not remove this event (status ${response.status}).`);
}

module.exports = { SCOPE, WRITE_SCOPE, accessToken, buildAuthUrl, deleteManagedEvent, insertEvent, listCalendars, listEvents, listManagedEvents, signIn, updateManagedEvent };
