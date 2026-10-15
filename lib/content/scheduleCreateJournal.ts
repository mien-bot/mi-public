import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { renameDurably, retryWhileLocked } from "./durableRename";
import { REPO_ROOT } from "./paths";

export interface ScheduleCreateResult {
  id: string;
  url: string;
}

interface ScheduleCreateState {
  requestId: string;
  fingerprint: string;
  phase: "pending-review" | "complete";
  result?: ScheduleCreateResult;
}

export type ScheduleCreateReservation =
  | { status: "reserved" }
  | { status: "pending-review" }
  | { status: "already-applied"; result: ScheduleCreateResult }
  | { status: "mismatch" };

function statePath(requestId: string, root: string): string {
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(requestId)) {
    throw new Error("A valid schedule request id is required.");
  }
  return path.join(root, ".mi", "schedule-create", `${requestId}.json`);
}

function fingerprint(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readState(filePath: string): ScheduleCreateState {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as ScheduleCreateState;
}

/**
 * Persists a request key before Notion is contacted. A crash or lost response therefore
 * becomes a visible pending-review stop instead of a silent duplicate on retry.
 */
export function reserveScheduleCreate(
  requestId: string,
  payload: unknown,
  root: string = REPO_ROOT,
): ScheduleCreateReservation {
  const filePath = statePath(requestId, root);
  const expectedFingerprint = fingerprint(payload);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const state: ScheduleCreateState = {
    requestId,
    fingerprint: expectedFingerprint,
    phase: "pending-review",
  };
  try {
    // "wx" is the reservation itself: EEXIST means another attempt already claimed this id, and
    // retryWhileLocked deliberately lets that through untouched while absorbing a Dropbox lock.
    retryWhileLocked(() =>
      fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
    );
    return { status: "reserved" };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
  }

  const prior = readState(filePath);
  if (prior.fingerprint !== expectedFingerprint) return { status: "mismatch" };
  if (prior.phase === "complete" && prior.result) {
    return { status: "already-applied", result: prior.result };
  }
  return { status: "pending-review" };
}

export function completeScheduleCreate(
  requestId: string,
  payload: unknown,
  result: ScheduleCreateResult,
  root: string = REPO_ROOT,
): void {
  const filePath = statePath(requestId, root);
  const prior = readState(filePath);
  const expectedFingerprint = fingerprint(payload);
  if (prior.fingerprint !== expectedFingerprint || prior.phase !== "pending-review") {
    throw new Error("The schedule-create journal changed before completion.");
  }
  const completed: ScheduleCreateState = { ...prior, phase: "complete", result };
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    retryWhileLocked(() =>
      fs.writeFileSync(temporary, `${JSON.stringify(completed, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
    );
    renameDurably(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}
