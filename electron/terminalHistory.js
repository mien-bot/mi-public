const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Private, encrypted, append-only output. Each frame commits independently, so an
// interrupted final write cannot destroy earlier history. Never persist PTY input.
function createTerminalHistory({ directory, secureStorage, replayLimit = 512_000, segmentBytes = 2_000_000 }) {
  const latestFiles = new Map();
  function filename(key, cwd) {
    const digest = crypto.createHash("sha256").update(JSON.stringify([key, cwd])).digest("hex");
    return path.join(typeof directory === "function" ? directory() : directory, `${digest}.history`);
  }
  function available() {
    if (!secureStorage.isEncryptionAvailable()) throw new Error("Terminal history encryption is unavailable.");
  }
  function segments(base) {
    if (!fs.existsSync(path.dirname(base))) return [];
    const name = path.basename(base);
    return fs.readdirSync(path.dirname(base))
      .filter(entry => entry === name || (entry.startsWith(`${name}.`) && /^\d{8}$/.test(entry.slice(name.length + 1))))
      .sort().map(entry => path.join(path.dirname(base), entry));
  }
  function readSegment(file) {
    const fd = fs.openSync(file, "r+");
    let offset = 0;
    let output = "";
    try {
      const size = fs.fstatSync(fd).size;
      const header = Buffer.alloc(4);
      while (offset + 4 <= size) {
        fs.readSync(fd, header, 0, 4, offset);
        const length = header.readUInt32LE();
        if (length === 0 || length > 8_000_000 || offset + 4 + length > size) break;
        const frame = Buffer.alloc(length);
        fs.readSync(fd, frame, 0, length, offset + 4);
        // A decryption failure must not truncate an otherwise complete archive.
        output = (output + secureStorage.decryptString(frame)).slice(-replayLimit);
        offset += 4 + length;
      }
      if (offset < size) fs.ftruncateSync(fd, offset);
    } finally {
      fs.closeSync(fd);
    }
    return output;
  }
  function load(key, cwd) {
    available();
    const base = filename(key, cwd);
    const files = segments(base);
    latestFiles.set(base, files.at(-1) || base);
    let output = "";
    // Only scan the newest bounded segments on restart, even after months of output.
    for (let index = files.length - 1; index >= 0 && output.length < replayLimit; index--) {
      output = (readSegment(files[index]) + output).slice(-replayLimit);
    }
    return output;
  }
  function append(key, cwd, output) {
    available();
    const base = filename(key, cwd);
    let file = latestFiles.get(base) || segments(base).at(-1) || base;
    if (fs.existsSync(file) && fs.statSync(file).size >= segmentBytes) {
      const index = file === base ? 1 : Number(file.slice(base.length + 1)) + 1;
      file = `${base}.${String(index).padStart(8, "0")}`;
    }
    latestFiles.set(base, file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const encrypted = secureStorage.encryptString(output);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(encrypted.length);
    const fd = fs.openSync(file, "a", 0o600);
    const priorSize = fs.fstatSync(fd).size;
    try {
      fs.writeFileSync(fd, Buffer.concat([header, encrypted]));
      fs.fsyncSync(fd);
    } catch (error) {
      // A disk-full/short-write retry must not append behind an incomplete frame.
      try { fs.ftruncateSync(fd, priorSize); } catch { /* Startup recovery handles the tail. */ }
      throw error;
    } finally {
      fs.closeSync(fd);
    }
  }
  return { load, append };
}

module.exports = { createTerminalHistory };
