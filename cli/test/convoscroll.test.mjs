// Command-line acceptance tests (P9C-003). They drive real headless Chrome, so
// they run through `npm run test:cli` instead of the jsdom unit suite.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DIST, ORIGIN, installRoutes, launchBrowser, partPath, resolveLocalFile } from "../render-cli.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = join(ROOT, "cli", "convoscroll.mjs");
const FIXTURES = join(ROOT, "fixtures");
let work;

function run(...args) {
  const result = spawnSync(process.execPath, [CLI, ...args, "--json"], { cwd: ROOT, encoding: "utf8", timeout: 180_000 });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr };
}

function pngSize(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** A working directory holding a copy of the v2 sample and the files it references. */
function sampleDirectory(name) {
  const directory = join(work, name);
  mkdirSync(join(directory, "assets"), { recursive: true });
  cpSync(join(FIXTURES, "conversation-v2.md"), join(directory, "chat.md"));
  for (const file of ["sea-horizon.svg", "sea-character-notes.md"]) {
    cpSync(join(FIXTURES, "assets", file), join(directory, "assets", file));
  }
  return directory;
}

before(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "convoscroll-cli-")));
});

after(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("arguments", () => {
  it("prints help and rejects unknown commands or options", () => {
    const help = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /convoscroll render/);

    assert.equal(run("draw", "x.md").status, 1);
    assert.equal(run("render", "x.md", "--scale", "4").json.code, "INVALID_ARGUMENTS");
    assert.equal(run("check", "x.md", "-o", "x.png").json.code, "INVALID_ARGUMENTS");
    assert.equal(run("render", join(work, "missing.md")).json.code, "INPUT_NOT_FOUND");
    assert.equal(run("render", join(work, "chat.pdf")).json.code, "UNSUPPORTED_INPUT");
  });

  it("names split parts like the web export", () => {
    assert.equal(partPath("/a/chat.png", 0, 1), "/a/chat.png");
    assert.equal(partPath("/a/chat.png", 1, 3), "/a/chat-part-02-of-03.png");
  });
});

describe("check", () => {
  it("validates the v2 sample without writing files", () => {
    const directory = sampleDirectory("check");
    const result = run("check", join(directory, "chat.md"));

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(result.json.summary, { title: "海平线到底有多远", messageCount: 3, blockCount: 8, assetCount: 2 });
    assert.deepEqual(readdirSync(directory).sort(), ["assets", "chat.md"]);
  });

  it("reports the source line of an invalid marker and exits 1", () => {
    const input = join(work, "broken.md");
    writeFileSync(input, `<!-- conversation-markdown:v2 -->
<!-- message: {"role":"assistant"} -->
正文
<!-- tool-call: {"toolName":"search","arguments":{}} -->
<!-- /message -->
`);
    const result = run("render", input, "-o", join(work, "broken.png"));

    assert.equal(result.status, 1);
    assert.equal(result.json.code, "UNKNOWN_CONVERSATION_MARKDOWN_FIELD");
    assert.equal(result.json.path, "line:4.arguments");
    assert.equal(existsSync(join(work, "broken.png")), false);
  });

  it("reports a missing referenced file with its line", () => {
    const directory = sampleDirectory("missing");
    rmSync(join(directory, "assets", "sea-horizon.svg"));
    const result = run("check", join(directory, "chat.md"));

    assert.equal(result.status, 1);
    assert.equal(result.json.code, "MISSING_CONVERSATION_MARKDOWN_FILE");
    assert.equal(result.json.path, "line:7");
  });

  it("refuses files that a symlink places outside the input directory", () => {
    const directory = sampleDirectory("escape");
    const outside = join(work, "outside.svg");
    cpSync(join(FIXTURES, "assets", "sea-horizon.svg"), outside);
    rmSync(join(directory, "assets", "sea-horizon.svg"));
    symlinkSync(outside, join(directory, "assets", "sea-horizon.svg"));
    const result = run("check", join(directory, "chat.md"));

    assert.equal(result.status, 1);
    assert.equal(result.json.code, "LOCAL_FILE_REJECTED");
    assert.deepEqual(resolveLocalFile(directory, "assets/sea-horizon.svg").status, 403);
    assert.deepEqual(resolveLocalFile(directory, "../outside.svg").status, 403);
    assert.deepEqual(resolveLocalFile(directory, "assets/none.svg").status, 404);
  });
});

describe("render", () => {
  it("renders the v2 sample, writes a project package and is byte-for-byte repeatable", () => {
    const directory = sampleDirectory("render");
    const first = run("render", join(directory, "chat.md"), "-o", join(directory, "out", "first.png"), "--project", join(directory, "out", "chat.convcanvas"));
    const second = run("render", join(directory, "chat.md"), "-o", join(directory, "out", "second.png"));

    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.equal(first.json.files.length, 1);
    assert.equal(first.json.files[0].width, 1440);
    assert.deepEqual(pngSize(first.json.files[0].path), { width: 1440, height: first.json.files[0].height });
    assert.equal(readFileSync(join(directory, "out", "chat.convcanvas")).subarray(0, 2).toString("ascii"), "PK");
    assert.deepEqual(first.json.blockedRequests, []);
    assert.ok(readFileSync(first.json.files[0].path).equals(readFileSync(second.json.files[0].path)));
  });

  it("rejects output collisions and protects input attachments", () => {
    const directory = sampleDirectory("output-collisions");
    const input = join(directory, "chat.md");
    const output = join(directory, "out.png");
    const original = readFileSync(input);
    assert.equal(run("render", input, "-o", output, "--project", output).json.code, "OUTPUT_PATH_COLLISION");
    assert.equal(existsSync(output), false);
    assert.equal(run("render", input, "-o", input).json.code, "OUTPUT_INPUT_COLLISION");
    assert.deepEqual(readFileSync(input), original);
    const attachment = join(directory, "assets", "sea-character-notes.md");
    const attachmentBytes = readFileSync(attachment);
    assert.equal(run("render", input, "-o", attachment).json.code, "OUTPUT_INPUT_COLLISION");
    assert.deepEqual(readFileSync(attachment), attachmentBytes);
  });

  it("leaves existing PNG intact when a later output target is invalid", () => {
    const directory = sampleDirectory("output-failure");
    const output = join(directory, "old.png");
    writeFileSync(output, "previous image");
    const result = run("render", join(directory, "chat.md"), "-o", output, "--project", join(directory, "assets"));
    assert.equal(result.json.code, "INVALID_OUTPUT_TARGET");
    assert.equal(readFileSync(output, "utf8"), "previous image");
  });

  it("renders a .convcanvas package back to the same image", () => {
    const directory = sampleDirectory("roundtrip");
    const project = join(directory, "chat.convcanvas");
    const fromMarkdown = run("render", join(directory, "chat.md"), "-o", join(directory, "md.png"), "--project", project);
    const fromProject = run("render", project, "-o", join(directory, "project.png"));

    assert.equal(fromProject.status, 0, fromProject.stdout + fromProject.stderr);
    assert.ok(readFileSync(fromMarkdown.json.files[0].path).equals(readFileSync(fromProject.json.files[0].path)));
  });

  it("splits the Long fixture into ordered parts and suggests a single-image scale", () => {
    const result = run("render", join(FIXTURES, "long.fixture.json"), "-o", join(work, "long", "long.png"));

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.json.files.length > 1);
    result.json.files.forEach((file, index) => {
      assert.equal(file.path, partPath(join(work, "long", "long.png"), index, result.json.files.length));
      assert.deepEqual(pngSize(file.path), { width: 1440, height: file.height });
    });
    assert.equal(result.json.scale, 3);
    assert.equal(result.json.singleImageScale, 2);
  });

  it("reserves the real continuation heading near the per-image memory limit", () => {
    const input = join(work, "boundary.json");
    const document = JSON.parse(readFileSync(join(FIXTURES, "basic.fixture.json"), "utf8"));
    document.metadata = { title: "Boundary" };
    document.messages = [
      { id: "first", role: "user", blocks: [{ id: "a", type: "markdown", source: "first" }] },
      { id: "second", role: "assistant", blocks: [
        { id: "b", type: "markdown", source: Array(268).fill("line").join("  \n") },
        { id: "c", type: "markdown", source: Array(10).fill("line").join("  \n") + "\n\nparagraph" },
      ] },
    ];
    writeFileSync(input, JSON.stringify(document));
    const result = run("render", input, "-o", join(work, "boundary.png"));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.json.files.length, 3);
    for (const output of result.json.files) {
      const { width, height } = pngSize(output.path);
      assert.ok(width * height * 4 <= 128 * 1024 * 1024);
      assert.ok(height <= 24000);
    }
  });

  it("does not request remote images written in Markdown", () => {
    const input = join(work, "remote.md");
    writeFileSync(input, `<!-- conversation-markdown:v2 -->
<!-- message: {"role":"user"} -->
![远程图片](https://example.com/tracker.png) [链接](https://example.com)
<!-- /message -->
`);
    const result = run("render", input, "-o", join(work, "remote.png"));

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(result.json.blockedRequests, []);
  });
});

describe("network policy", () => {
  it("aborts and records every request outside the render origin", async () => {
    const blocked = [];
    const browser = await launchBrowser("chrome");
    try {
      const context = await browser.newContext();
      await installRoutes(context, {
        input: join(FIXTURES, "conversation-v2.md"),
        inputDirectory: FIXTURES,
        distRoot: realpathSync(DIST),
        blocked,
      });
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/render.html`);
      const outcome = await page.evaluate(async () => {
        const fetched = await fetch("https://example.com/leak").then(() => "loaded", () => "blocked");
        const image = await new Promise((done) => {
          const element = new Image();
          element.onload = () => done("loaded");
          element.onerror = () => done("blocked");
          element.src = "https://example.com/pixel.png";
        });
        const local = await fetch("/__convoscroll/local/..%2Fpackage.json").then((response) => response.status);
        return { fetched, image, local };
      });

      assert.deepEqual(outcome, { fetched: "blocked", image: "blocked", local: 403 });
      assert.deepEqual(blocked, ["https://example.com/leak", "https://example.com/pixel.png"]);
    } finally {
      await browser.close();
    }
  });
});
