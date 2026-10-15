export interface RemoteAccessEnvironment {
  [key: string]: string | undefined;
  MI_REMOTE_ACCESS?: string;
  MI_REMOTE_HOSTNAME?: string;
  MI_CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
  MI_CLOUDFLARE_ACCESS_AUD?: string;
  MI_REMOTE_ALLOWED_EMAILS?: string;
}

export interface RemoteAccessConfig {
  enabled: boolean;
  hostname: string;
  teamDomain: string;
  audience: string;
  allowedEmails: ReadonlySet<string>;
}

export class RemoteAccessConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteAccessConfigurationError";
  }
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new RemoteAccessConfigurationError(`${label} is required when remote access is enabled.`);
  return normalized;
}

export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function isLoopbackHostname(value: string): boolean {
  const hostname = normalizeHostname(value).replace(/^\[(.*)\]$/, "$1");
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

export function readRemoteAccessConfig(
  environment: RemoteAccessEnvironment = process.env,
): RemoteAccessConfig | null {
  if (environment.MI_REMOTE_ACCESS !== "1") return null;

  const hostname = normalizeHostname(required(environment.MI_REMOTE_HOSTNAME, "MI_REMOTE_HOSTNAME"));
  if (isLoopbackHostname(hostname) || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(hostname)) {
    throw new RemoteAccessConfigurationError("MI_REMOTE_HOSTNAME must be one non-loopback hostname without a port.");
  }

  const rawTeamDomain = required(
    environment.MI_CLOUDFLARE_ACCESS_TEAM_DOMAIN,
    "MI_CLOUDFLARE_ACCESS_TEAM_DOMAIN",
  );
  let teamDomain: URL;
  try {
    teamDomain = new URL(rawTeamDomain);
  } catch {
    throw new RemoteAccessConfigurationError("MI_CLOUDFLARE_ACCESS_TEAM_DOMAIN must be an HTTPS URL.");
  }
  if (
    teamDomain.protocol !== "https:"
    || teamDomain.username
    || teamDomain.password
    || teamDomain.search
    || teamDomain.hash
    || teamDomain.port
    || teamDomain.pathname !== "/"
    || !teamDomain.hostname.endsWith(".cloudflareaccess.com")
  ) {
    throw new RemoteAccessConfigurationError(
      "MI_CLOUDFLARE_ACCESS_TEAM_DOMAIN must be the HTTPS Cloudflare Access team domain.",
    );
  }

  const allowedEmails = new Set(
    required(environment.MI_REMOTE_ALLOWED_EMAILS, "MI_REMOTE_ALLOWED_EMAILS")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  if (
    allowedEmails.size === 0
    || [...allowedEmails].some((email) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
  ) {
    throw new RemoteAccessConfigurationError("MI_REMOTE_ALLOWED_EMAILS must contain valid email addresses.");
  }

  return {
    enabled: true,
    hostname,
    teamDomain: teamDomain.origin,
    audience: required(environment.MI_CLOUDFLARE_ACCESS_AUD, "MI_CLOUDFLARE_ACCESS_AUD"),
    allowedEmails,
  };
}

export function isExpectedRemoteHostname(hostname: string, config: RemoteAccessConfig): boolean {
  return normalizeHostname(hostname) === config.hostname;
}
