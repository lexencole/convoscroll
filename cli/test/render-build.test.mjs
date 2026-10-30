import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, it } from "node:test";
import { renderBuildIsStale } from "../render-cli.mjs";
let work;
const old = new Date("2020-01-01T00:00:00Z");
const built = new Date("2021-01-01T00:00:00Z");
const changed = new Date("2022-01-01T00:00:00Z");
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "convoscroll-build-test-"));
  for (const name of ["src", "fixtures", "public", "dist-cli"]) mkdirSync(join(work, name));
  for (const path of ["src/main.ts", "fixtures/image.svg", "public/icon.svg", "render.html", "vite.config.ts", "package.json", "package-lock.json", "tsconfig.app.json"]) {
    writeFileSync(join(work, path), "input"); utimesSync(join(work, path), old, old);
  }
  for (const name of ["src", "fixtures", "public"]) utimesSync(join(work, name), old, old);
  writeFileSync(join(work, "dist-cli/render.html"), "built");
  writeFileSync(join(work, "dist-cli/.convoscroll-build-complete"), "complete-v1\n");
  utimesSync(join(work, "dist-cli/.convoscroll-build-complete"), built, built);
});
afterEach(() => rmSync(work, { recursive: true, force: true }));
it("reuses a completed current build", () => assert.equal(renderBuildIsStale(work), false));
it("invalidates all imported assets, config and dependency inputs", () => {
  for (const path of ["src/main.ts", "fixtures/image.svg", "public/icon.svg", "render.html", "vite.config.ts", "package.json", "package-lock.json", "tsconfig.app.json"]) {
    utimesSync(join(work, path), changed, changed);
    assert.equal(renderBuildIsStale(work), true, path);
    utimesSync(join(work, path), old, old);
    assert.equal(renderBuildIsStale(work), false, path);
  }
});
it("does not reuse a partial build even with a newly written render.html", () => {
  rmSync(join(work, "dist-cli/.convoscroll-build-complete"));
  utimesSync(join(work, "dist-cli/render.html"), changed, changed);
  assert.equal(renderBuildIsStale(work), true);
  writeFileSync(join(work, "dist-cli/.convoscroll-build-complete"), "incomplete");
  assert.equal(renderBuildIsStale(work), true);
});
it("detects removal of a source through the containing directory timestamp", () => {
  rmSync(join(work, "fixtures/image.svg"));
  utimesSync(join(work, "fixtures"), changed, changed);
  assert.equal(renderBuildIsStale(work), true);
});
