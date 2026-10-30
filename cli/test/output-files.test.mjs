import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "node:test";
import { writeOutputFiles } from "../output-files.mjs";
let work;
beforeEach(() => { work = fs.mkdtempSync(join(tmpdir(), "convoscroll-output-test-")); });
afterEach(() => fs.rmSync(work, { recursive: true, force: true }));
const file = (name, bytes = "new") => ({ path: join(work, name), bytes: Buffer.from(bytes) });
const read = (name) => fs.readFileSync(join(work, name), "utf8");
function fails(files, protectedPaths, code, io) {
  assert.throws(() => writeOutputFiles(files, protectedPaths, io), (error) => error.code === code);
}
it("replaces existing outputs and creates nested outputs without leaving backups", () => {
  fs.writeFileSync(join(work, "a.png"), "old");
  writeOutputFiles([file("a.png"), file("nested/project")], []);
  assert.equal(read("a.png"), "new"); assert.equal(read("nested/project"), "new");
  assert.deepEqual(fs.readdirSync(work).sort(), ["a.png", "nested"]);
  assert.deepEqual(fs.readdirSync(join(work, "nested")), ["project"]);
});
it("rejects duplicate outputs, ancestor conflicts, directories and symlink targets before writes", () => {
  fails([file("a"), file("a")], [], "OUTPUT_PATH_COLLISION");
  fails([file("a"), file("a/b")], [], "OUTPUT_PATH_COLLISION");
  fs.mkdirSync(join(work, "dir"));
  fails([file("first"), file("dir")], [], "INVALID_OUTPUT_TARGET");
  fs.writeFileSync(join(work, "source"), "source");
  fs.symlinkSync(join(work, "source"), join(work, "link"));
  fails([file("link")], [], "INVALID_OUTPUT_TARGET");
  assert.equal(fs.existsSync(join(work, "first")), false); assert.equal(read("source"), "source");
});
it("protects input and attachment inodes including parent aliases and hardlinks", () => {
  fs.mkdirSync(join(work, "real")); fs.symlinkSync(join(work, "real"), join(work, "alias"));
  fs.writeFileSync(join(work, "real/input"), "input");
  fs.linkSync(join(work, "real/input"), join(work, "hard"));
  for (const path of ["real/input", "alias/input", "hard"]) fails([file(path)], [join(work, "real/input")], "OUTPUT_INPUT_COLLISION");
  fails([file("real/new"), file("alias/new")], [], "OUTPUT_PATH_COLLISION");
  fs.writeFileSync(join(work, "other"), "old"); fs.linkSync(join(work, "other"), join(work, "other-hard"));
  fails([file("other"), file("other-hard")], [], "OUTPUT_PATH_COLLISION");
  assert.equal(read("real/input"), "input");
});
it("a staging failure preserves every previous destination and removes temporary files", () => {
  fs.writeFileSync(join(work, "a"), "old"); let count = 0;
  fails([file("a"), file("b")], [], "OUTPUT_WRITE_FAILED", { ...fs, writeFileSync(...args) {
    if (++count === 2) throw new Error("disk full"); return fs.writeFileSync(...args);
  }});
  assert.equal(read("a"), "old"); assert.deepEqual(fs.readdirSync(work), ["a"]);
});
it("a later rename failure restores replaced files and removes already installed new files", () => {
  fs.writeFileSync(join(work, "a"), "old");
  fails([file("a"), file("b"), file("c")], [], "OUTPUT_WRITE_FAILED", { ...fs, renameSync(from, to) {
    if (to === join(work, "c")) throw new Error("rename failed"); return fs.renameSync(from, to);
  }});
  assert.equal(read("a"), "old"); assert.deepEqual(fs.readdirSync(work), ["a"]);
});
it("restores the original if installing its replacement fails after backup", () => {
  fs.writeFileSync(join(work, "a"), "old");
  fails([file("a")], [], "OUTPUT_WRITE_FAILED", { ...fs, renameSync(from, to) {
    if (from.endsWith("/new")) throw new Error("install failed"); return fs.renameSync(from, to);
  }});
  assert.equal(read("a"), "old"); assert.deepEqual(fs.readdirSync(work), ["a"]);
});
it("keeps a recovery backup and reports its path if restoring the original fails", () => {
  fs.writeFileSync(join(work, "a"), "old");
  let error;
  try { writeOutputFiles([file("a")], [], { ...fs, renameSync(from, to) {
    if (to === join(work, "a")) throw new Error("destination inaccessible"); return fs.renameSync(from, to);
  }}); } catch (caught) { error = caught; }
  assert.equal(error.code, "OUTPUT_RECOVERY_FAILED");
  assert.equal(fs.readFileSync(error.details.recovery[0].backup, "utf8"), "old");
});
it("reports committed output and remaining backup if cleanup fails", () => {
  fs.writeFileSync(join(work, "a"), "old"); let error;
  try { writeOutputFiles([file("a")], [], { ...fs, rmSync() { throw new Error("cleanup failed"); } }); } catch (caught) { error = caught; }
  assert.equal(error.code, "OUTPUT_CLEANUP_FAILED"); assert.equal(error.details.committed, true);
  assert.equal(read("a"), "new"); assert.equal(fs.readFileSync(join(error.details.cleanup[0], "previous"), "utf8"), "old");
});
it("does not replace a target changed during staging", () => {
  fs.writeFileSync(join(work, "a"), "old");
  fails([file("a")], [], "OUTPUT_WRITE_FAILED", { ...fs, writeFileSync(...args) {
    fs.writeFileSync(...args); fs.writeFileSync(join(work, "a"), "concurrent change");
  }});
  assert.equal(read("a"), "concurrent change");
});
