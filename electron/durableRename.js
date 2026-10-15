// Generated from lib/content/durableRename.ts; keep behavior synchronized.
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryWhileLocked = retryWhileLocked;
exports.renameDurably = renameDurably;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const recoveryRecord_1 = require("./recoveryRecord");
/**
 * Windows + Dropbox: a file Mi has just written inside the firm's shared Dropbox folder is
 * opened almost immediately by the Dropbox client (and by Defender) so it can be indexed and
 * uploaded, and those handles are not opened with FILE_SHARE_DELETE. `MoveFileEx` -- what
 * `fs.renameSync` calls -- then fails with EPERM even though the write itself was perfect and
 * the same rename succeeds a few tens of milliseconds later.
 *
 * That is the whole of the partner-facing "EPERM: operation not permitted, rename
 * '...json.40620.tmp' -> '...json'" failure: every atomic writer in Mi writes a temp file
 * beside its target and renames it into place, so on a Dropbox-backed installation any of them
 * could fail on a busy sync. Retrying briefly clears it; when the lock is on the *source* temp
 * file only -- the common case, because that file is the one Dropbox just noticed -- a plain
 * copy to a fresh staging file can succeed where moving the original source cannot. The
 * staging file must still be atomically renamed; never copy over a live destination.
 *
 * Keep this behavior synchronized with `electron/durableRename.js`, which is the same helper
 * for the desktop main process.
 */
/** Codes Windows reports for "someone else has this file open right now". */
const TRANSIENT_CODES = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY", "UNKNOWN"]);
/** Backs off to ~0.8s total. Long enough to outlast a Dropbox indexing handle, short enough
 * that a request handler blocking on it stays inside a normal click's patience. */
const RETRY_DELAYS_MS = [10, 25, 50, 100, 200, 400];
function isTransient(cause) {
    const code = cause?.code;
    return typeof code === "string" && TRANSIENT_CODES.has(code);
}
/** Blocking sleep. These writers are synchronous all the way up, and the alternative --
 * making every caller async -- would change far more than the failure it fixes. */
function sleepSync(milliseconds) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
/**
 * Runs a synchronous filesystem operation, retrying only the "file is momentarily locked"
 * errors. Anything else (ENOENT, ENOSPC, a permissions problem that is really a permissions
 * problem) throws on the first attempt, unchanged.
 */
function retryWhileLocked(operation) {
    for (let attempt = 0;; attempt++) {
        try {
            return operation();
        }
        catch (cause) {
            if (attempt >= RETRY_DELAYS_MS.length || !isTransient(cause))
                throw cause;
            sleepSync(RETRY_DELAYS_MS[attempt]);
        }
    }
}
/**
 * Moves `source` onto `target`, surviving a Dropbox or antivirus handle on either one.
 *
 * Directories are retried but never copied: a half-copied directory tree is worse than a
 * clear failure, and the only directory rename in Mi (a new library collection) is safe to
 * retry from scratch.
 */
function renameDurably(source, target) {
    const sourceIsFile = node_fs_1.default.statSync(source).isFile();
    const expectedHash = sourceIsFile ? (0, recoveryRecord_1.fileDigest)(target) : null;
    try {
        retryWhileLocked(() => {
            if (sourceIsFile && (0, recoveryRecord_1.fileDigest)(target) !== expectedHash)
                throw Object.assign(new Error("Destination changed during save. Review before retrying."), { code: "MI_CONFLICT" });
            node_fs_1.default.renameSync(source, target);
        });
        return { strategy: "rename" };
    }
    catch (cause) {
        if (!isTransient(cause))
            throw cause;
        if (!sourceIsFile)
            throw lockedError(source, target, cause);
        // Copy to a fresh staging file, NEVER across the live destination. A crash during
        // copy must leave the previous version intact. Keep independent recovery evidence
        // because callers may remove their own temporary source when handling an error.
        const manifest = (0, recoveryRecord_1.preserveRecovery)(source, target, expectedHash);
        const staged = node_path_1.default.join(node_path_1.default.dirname(target), `.mi-save-${(0, node_crypto_1.randomUUID)()}.tmp`);
        try {
            const payload = manifest.replace(/\.json$/, ".payload");
            node_fs_1.default.copyFileSync(payload, staged, node_fs_1.default.constants.COPYFILE_EXCL);
            if ((0, recoveryRecord_1.fileDigest)(staged) !== (0, recoveryRecord_1.fileDigest)(payload))
                throw new Error("Staging content failed its integrity check.");
            const fd = node_fs_1.default.openSync(staged, "r+");
            try {
                node_fs_1.default.fsyncSync(fd);
            }
            finally {
                node_fs_1.default.closeSync(fd);
            }
            retryWhileLocked(() => {
                if ((0, recoveryRecord_1.fileDigest)(target) !== expectedHash)
                    throw new Error("Destination changed during save. Review recovery before retrying.");
                node_fs_1.default.renameSync(staged, target);
            });
        }
        catch {
            const error = lockedError(source, target, cause);
            error.message = `Mi could not replace the file safely. Mi did not overwrite the destination. Review the pending save in Dropbox Files > Health and recovery. Recovery record: ${manifest}`;
            throw error;
        }
        finally {
            try {
                node_fs_1.default.rmSync(staged, { force: true });
            }
            catch { /* preserved payload is independent */ }
        }
        // The content is safely in place; a temp file Dropbox still has open is litter, not a
        // failure, and the next write cleans up after it.
        try {
            node_fs_1.default.writeFileSync(`${manifest}.done`, "Saved locally; cloud sync unverified.", { flag: "wx" });
        }
        catch { /* receipt failure is not a failed save */ }
        try {
            retryWhileLocked(() => node_fs_1.default.rmSync(source, { force: true }));
        }
        catch {
            // Intentionally ignored -- see above.
        }
        return { strategy: "copy" };
    }
}
function lockedError(source, target, cause) {
    const code = cause?.code ?? "EPERM";
    return Object.assign(new Error(`Another program is holding "${target}" open, so Mi could not finish the write (${code}). ` +
        "This is usually Dropbox syncing or antivirus scanning the file. Mi retried for a second " +
        "and left the content in a temporary file beside it. Wait for Dropbox to finish syncing " +
        `and try again; nothing was lost. Temporary file: ${source}`), { code, cause });
}
