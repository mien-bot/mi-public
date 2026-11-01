// Lessons a person has approved for CAD agents. Agents can only add to pending; nothing reaches
// the guide without a person accepting it in Set up MCP.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { GUIDE } = require("./drawingGuide");

const LIMIT = 100;
const MAX_LENGTH = 500;

function read(file) {
  try {
    if (fs.statSync(file).size > 1_048_576) throw new Error("Invalid lessons file.");
    const { accepted, pending } = JSON.parse(fs.readFileSync(file, "utf8"));
    return { accepted: Array.isArray(accepted) ? accepted : [], pending: Array.isArray(pending) ? pending : [] };
  } catch (e) {
    if (e.code === "ENOENT") return { accepted: [], pending: [] };
    throw e;
  }
}
function write(file, lessons) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(lessons, null, 2) + "\n", { flag: "wx" });
  fs.renameSync(temp, file);
}
function clean(text) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!value || value.length > MAX_LENGTH) throw new Error(`A lesson must be 1-${MAX_LENGTH} characters.`);
  return value;
}
const entry = text => ({ id: crypto.randomUUID(), text: clean(text), at: new Date().toISOString() });

function propose(file, text) {
  const lessons = read(file);
  const value = clean(text);
  if ([...lessons.accepted, ...lessons.pending].some(lesson => lesson.text === value)) return lessons;
  if (lessons.pending.length >= LIMIT) throw new Error("Too many lessons are waiting for review.");
  lessons.pending.push(entry(value));
  write(file, lessons);
  return lessons;
}
function add(file, text) {
  const lessons = read(file);
  if (lessons.accepted.length >= LIMIT) throw new Error("Remove a lesson before adding another.");
  lessons.accepted.push(entry(text));
  write(file, lessons);
  return lessons;
}
function review(file, id, accept) {
  const lessons = read(file);
  const lesson = lessons.pending.find(item => item.id === id);
  if (!lesson) throw new Error("That lesson is no longer waiting for review.");
  lessons.pending = lessons.pending.filter(item => item.id !== id);
  if (accept) lessons.accepted.push(lesson);
  write(file, lessons);
  return lessons;
}
function remove(file, id) {
  const lessons = read(file);
  lessons.accepted = lessons.accepted.filter(item => item.id !== id);
  write(file, lessons);
  return lessons;
}
function guide(file) {
  const { accepted } = read(file);
  if (!accepted.length) return GUIDE;
  return `${GUIDE}\n\n## Lessons this person approved\n${accepted.map(lesson => `- ${String(lesson.text)}`).join("\n")}`;
}

module.exports = { read, propose, add, review, remove, guide };
