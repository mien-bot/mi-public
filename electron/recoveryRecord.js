// Generated from lib/content/recoveryRecord.ts; keep behavior synchronized.
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileDigest = fileDigest;
exports.preserveRecovery = preserveRecovery;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
function fileDigest(file) {
    let fd;
    try {
        fd = node_fs_1.default.openSync(file, "r");
    }
    catch (error) {
        if (error.code === "ENOENT")
            return null;
        throw error;
    }
    try {
        const hash = (0, node_crypto_1.createHash)("sha256"), buffer = Buffer.alloc(64 * 1024);
        let count;
        while ((count = node_fs_1.default.readSync(fd, buffer, 0, buffer.length, null)))
            hash.update(buffer.subarray(0, count));
        return hash.digest("hex");
    }
    finally {
        node_fs_1.default.closeSync(fd);
    }
}
/** Immutable recovery evidence beside the destination; never overwrite a previous attempt. */
function preserveRecovery(source, target, expectedHash) {
    const folder = node_path_1.default.join(node_path_1.default.dirname(target), ".mi-recovery");
    node_fs_1.default.mkdirSync(folder, { recursive: true });
    if (node_fs_1.default.lstatSync(folder).isSymbolicLink())
        throw new Error("Recovery folder must not be a link.");
    const id = (0, node_crypto_1.randomUUID)();
    const payload = node_path_1.default.join(folder, `${id}.payload`);
    node_fs_1.default.copyFileSync(source, payload, node_fs_1.default.constants.COPYFILE_EXCL);
    const payloadHash = fileDigest(payload);
    if (fileDigest(source) !== payloadHash)
        throw new Error("Save changed while preserving recovery content.");
    if (expectedHash !== null) {
        const before = node_path_1.default.join(folder, `${id}.before`);
        node_fs_1.default.copyFileSync(target, before, node_fs_1.default.constants.COPYFILE_EXCL);
        if (fileDigest(before) !== expectedHash)
            throw new Error("Destination changed; review it before retrying.");
        const beforeFd = node_fs_1.default.openSync(before, "r+");
        try {
            node_fs_1.default.fsyncSync(beforeFd);
        }
        finally {
            node_fs_1.default.closeSync(beforeFd);
        }
    }
    const fd = node_fs_1.default.openSync(payload, "r+");
    try {
        node_fs_1.default.fsyncSync(fd);
    }
    finally {
        node_fs_1.default.closeSync(fd);
    }
    const record = { version: 1, id, target: node_path_1.default.basename(target), expectedHash, payloadHash, createdAt: new Date().toISOString() };
    const manifest = node_path_1.default.join(folder, `${id}.json`);
    const manifestFd = node_fs_1.default.openSync(manifest, "wx");
    try {
        node_fs_1.default.writeFileSync(manifestFd, JSON.stringify(record));
        node_fs_1.default.fsyncSync(manifestFd);
    }
    finally {
        node_fs_1.default.closeSync(manifestFd);
    }
    return manifest;
}
