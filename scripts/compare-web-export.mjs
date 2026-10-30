// Exports fixtures through the production web workbench (real clicks, real
// downloads) and through `convoscroll render`, then compares the bytes.
//
//   node scripts/compare-web-export.mjs [--dpr 1,2] [--fixtures rich-en,long-en] [--out <directory>]
//
// Story is built into the web and loaded with "文档 → 载入故事示例" (the web opens
// with the simple sample); it is exported at every requested device pixel ratio. Rich and Long go through `convoscroll render --project`, are imported
// into the web with the normal "文档 → 导入" flow, and Long keeps the split choice.
// v2 is fixtures/conversation-v2.md (Conversation Markdown v2 with local files).
// The web build is served from a temporary directory on a fake origin with every
// other request blocked, the same isolation the command line uses.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { unzipSync } from "fflate";
import { launchBrowser } from "../cli/render-cli.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "http://web.localhost";
const { values } = parseArgs({
  options: {
    dpr: { type: "string", default: "1,2" },
    out: { type: "string", default: join(ROOT, "output", "compare-web-export") },
    fixtures: { type: "string" },
  },
});
const ratios = values.dpr.split(",").map(Number);
const out = resolve(values.out);
mkdirSync(out, { recursive: true });

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const size = (bytes) => `${bytes.readUInt32BE(16)}×${bytes.readUInt32BE(20)}`;

function cliRender(input, output, extra = []) {
  const args = [join(ROOT, "cli", "convoscroll.mjs"), "render", input, "-o", output, "--json", ...extra];
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`command line failed for ${input}:\n${result.stdout}${result.stderr}`);
  const json = JSON.parse(result.stdout);
  return { parts: json.files.map((file) => readFileSync(file.path)), blocked: json.blockedRequests.length };
}

/**
 * Story renders straight from its JSON. Imported fixtures are first packaged with
 * --project, and the package itself is rendered, because the web imports that package
 * (packaging normalizes asset sources and sizes, so it is not byte-identical input).
 */
function renderWithCli(fixture, imported) {
  let json = join(ROOT, "fixtures", fixture === "v2" ? "conversation-v2.md" : `${fixture}.fixture.json`);
  if (fixture === "rich-en" || fixture === "long-en") {
    const document = JSON.parse(readFileSync(join(ROOT, "fixtures", `${fixture.replace(/-en$/, "")}.fixture.json`), "utf8"));
    document.metadata.locale = "en";
    json = join(out, `${fixture}.fixture.json`);
    writeFileSync(json, JSON.stringify(document));
  }
  if (!imported) return cliRender(json, join(out, `${fixture}-cli.png`));
  const project = join(out, `${fixture}.convcanvas`);
  cliRender(json, join(out, `${fixture}-cli-from-json.png`), ["--project", project]);
  return { ...cliRender(project, join(out, `${fixture}-cli.png`)), project };
}

async function exportFromWeb(buildRoot, ratio, project, locale = "zh-CN", fixture = "story") {
  const labels = locale === "en" ? JSON.parse(readFileSync(join(ROOT, "src/i18n/en.json"), "utf8")) : {};
  const t = (key) => labels[key] ?? key;
  const browser = await launchBrowser("chrome");
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: ratio, locale, acceptDownloads: true });
    const blocked = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) {
        blocked.push(url.href);
        return route.abort("blockedbyclient");
      }
      let file = join(buildRoot, decodeURIComponent(url.pathname));
      try {
        if (!statSync(file).isFile()) throw new Error();
      } catch {
        file = join(buildRoot, "index.html"); // single-page fallback
      }
      const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm" }[extname(file)] ?? "application/octet-stream";
      return route.fulfill({ status: 200, body: readFileSync(file), contentType: type });
    });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/`);
    await page.getByTestId("conversation-canvas").waitFor();

    if (!project) {
      if (!fixture.startsWith("basic")) {
        await page.getByRole("button", { name: t("文档"), exact: true }).click();
        await page.getByRole("menuitem", { name: t("载入故事示例") }).click();
      }
      const expected = JSON.parse(readFileSync(join(ROOT, "fixtures", `${fixture}.fixture.json`), "utf8"));
      await page.getByRole("button", { name: t("编辑标题"), exact: true }).filter({ hasText: expected.metadata.title }).waitFor();
    } else {
      await page.getByRole("button", { name: t("文档"), exact: true }).click();
      await page.locator('[data-testid="project-import-input"]').setInputFiles(project);
      await page.getByRole("button", { name: t("替换当前项目") }).click();
      await page.getByRole("dialog", { name: t("导入预览"), exact: true }).waitFor({ state: "hidden" });
    }

    const download = page.waitForEvent("download", { timeout: 90_000 });
    await page.locator(".export-control__button").click();
    const keep = page.getByRole("button", { name: /^(保持 |Keep )/ });
    // Long content asks how to export; keep the scale and split, as the command line does.
    await Promise.race([download, keep.waitFor({ timeout: 60_000 }).then(() => keep.click())]).catch(() => undefined);
    // After that choice the browser no longer counts as a user gesture, so the web waits
    // for a click on its "下载 ZIP" link instead of downloading on its own.
    const link = page.locator(".export-dialog__download-link");
    await Promise.race([download, link.waitFor({ timeout: 120_000 }).then(() => link.click())]).catch(() => undefined);
    const file = await download.catch(async (error) => {
      await page.screenshot({ path: join(out, "web-export-failure.png") });
      const dialog = await page.locator(".export-dialog").innerText().catch(() => "(no dialog)");
      throw new Error(`web export produced no download; dialog says:\n${dialog}`, { cause: error });
    });
    const saved = join(out, `web-${Date.now()}-${file.suggestedFilename()}`);
    await file.saveAs(saved);
    const bytes = readFileSync(saved);
    rmSync(saved);
    const parts = file.suggestedFilename().endsWith(".zip")
      ? Object.entries(unzipSync(bytes)).sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => Buffer.from(entry))
      : [bytes];
    return { parts, blocked: blocked.length };
  } finally {
    await browser.close();
  }
}

const webBuild = mkdtempSync(join(tmpdir(), "convoscroll-web-"));
let mismatches = 0;
try {
  const build = spawnSync(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", webBuild, "--emptyOutDir", "--logLevel", "error"], { cwd: ROOT, encoding: "utf8" });
  if (build.status !== 0) throw new Error(`web build failed:\n${build.stdout}${build.stderr}`);
  const buildRoot = realpathSync(webBuild);

  const cases = [
    ...["basic", "basic-en", "story", "story-en"].flatMap((fixture) => ratios.map((ratio) => ({ fixture, ratio, imported: false }))),
    { fixture: "rich-en", ratio: 2, imported: true },
    { fixture: "long-en", ratio: 2, imported: true },
    { fixture: "rich", ratio: 2, imported: true },
    { fixture: "long", ratio: 2, imported: true },
    { fixture: "v2", ratio: 2, imported: true },
  ];
  const cliResults = new Map();
  if (values.fixtures && values.fixtures.split(",").some((name) => !cases.some((item) => item.fixture === name))) throw new Error("Unknown fixture selection");
  for (const { fixture, ratio, imported } of cases) {
    if (values.fixtures && !values.fixtures.split(",").includes(fixture)) continue;
    if (!cliResults.has(fixture)) cliResults.set(fixture, renderWithCli(fixture, imported));
    const cli = cliResults.get(fixture);
    const web = await exportFromWeb(buildRoot, ratio, imported ? cli.project : undefined, fixture.endsWith("-en") ? "en" : "zh-CN", fixture);
    const same = web.parts.length === cli.parts.length && web.parts.every((part, index) => part.equals(cli.parts[index]));
    if (!same) mismatches += 1;
    web.parts.forEach((part, index) => writeFileSync(join(out, `${fixture}-web-dpr${ratio}${web.parts.length > 1 ? `-part-${index + 1}` : ""}.png`), part));
    console.log([
      fixture.padEnd(5),
      `web DPR ${ratio}${imported ? " (imported)" : ""}`.padEnd(20),
      web.parts.map(size).join(" + ").padEnd(24),
      `sha256 ${web.parts.map((part) => sha(part).slice(0, 12)).join(" + ")}`,
      same ? "same as command line" : `DIFFERENT (command line: ${cli.parts.map(size).join(" + ")} ${cli.parts.map((part) => sha(part).slice(0, 12)).join(" + ")})`,
      `blocked web ${web.blocked} / cli ${cli.blocked}`,
    ].join("  "));
  }
} finally {
  rmSync(webBuild, { recursive: true, force: true });
}
process.exitCode = mismatches ? 1 : 0;
