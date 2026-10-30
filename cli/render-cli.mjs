// Core of the convoscroll command line: argument parsing, the
// offline route policy, headless rendering and output writing. cli/convoscroll.mjs
// is the executable entry; tests import this module directly.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync, readdirSync, writeFileSync, renameSync, rmSync, existsSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { OutputFileError, writeOutputFiles } from "./output-files.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DIST = join(ROOT, "dist-cli");
export const ORIGIN = "http://convoscroll.localhost";
const MiB = 1024 * 1024;
const INPUT_LIMITS = { markdown: 8 * MiB, json: 16 * MiB, project: 100 * MiB };
const LOCAL_FILE_LIMIT = 32 * MiB;

const EXIT = { ok: 0, input: 1, render: 2, environment: 3 };

const USAGE = `用法：
  convoscroll render <输入> [-o 输出.png] [--project 输出.convcanvas] [选项]
  convoscroll check <输入> [--json]

输入：Conversation Markdown（.md）、文档 JSON（.json）或项目文件（.convcanvas）。

选项：
  -o, --output <文件>     PNG 保存位置，默认和输入同名；太长时拆成 名称-part-01-of-03.png
      --project <文件>    同时保存 .convcanvas，可以导入网页继续修改
      --preset <名称>     portrait（默认，480 宽）或 wide（720 宽）
      --scale <1|2|3>     清晰度，portrait 默认 3，wide 默认 2
      --fold <策略>       思考过程和工具调用：block（默认，按每块的设置）、collapsed（全部收起）或 expanded（全部展开）
      --browser <名称>    chrome（默认，本机 Google Chrome）或 chromium（Playwright 自带）
      --json              输出 JSON 结果，方便程序读取
  -h, --help              显示帮助

退出码：0 成功，1 输入有误，2 出图失败，3 环境问题（如找不到 Chrome）。`;

class CliError extends Error {
  constructor(exitCode, code, message, details = {}) {
    super(message);
    this.exitCode = exitCode;
    this.code = code;
    this.details = details;
  }
}

export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        project: { type: "string" },
        preset: { type: "string", default: "portrait" },
        scale: { type: "string" },
        fold: { type: "string", default: "block" },
        browser: { type: "string", default: "chrome" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    throw new CliError(EXIT.input, "INVALID_ARGUMENTS", error.message);
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) return { help: true, json: values.json };
  const [command, input, ...rest] = positionals;
  if (command !== "render" && command !== "check") {
    throw new CliError(EXIT.input, "INVALID_ARGUMENTS", `未知命令：${command}`);
  }
  if (!input || rest.length) throw new CliError(EXIT.input, "INVALID_ARGUMENTS", "请给一个输入文件。");
  if (!["portrait", "wide"].includes(values.preset)) throw new CliError(EXIT.input, "INVALID_ARGUMENTS", "--preset 只能是 portrait 或 wide。");
  if (values.scale !== undefined && !["1", "2", "3"].includes(values.scale)) throw new CliError(EXIT.input, "INVALID_ARGUMENTS", "--scale 只能是 1、2 或 3。");
  if (!["block", "collapsed", "expanded"].includes(values.fold)) throw new CliError(EXIT.input, "INVALID_ARGUMENTS", "--fold 只能是 block、collapsed 或 expanded。");
  if (!["chrome", "chromium"].includes(values.browser)) throw new CliError(EXIT.input, "INVALID_ARGUMENTS", "--browser 只能是 chrome 或 chromium。");
  if (command === "check" && (values.output || values.project)) {
    throw new CliError(EXIT.input, "INVALID_ARGUMENTS", "check 只做检查，不能加 -o 或 --project。");
  }
  return {
    command,
    input: resolve(input),
    output: values.output ? resolve(values.output) : undefined,
    project: values.project ? resolve(values.project) : undefined,
    preset: values.preset,
    scale: values.scale ? Number(values.scale) : undefined,
    fold: values.fold,
    browser: values.browser,
    json: values.json,
  };
}

function inputKind(path) {
  const extension = extname(path).toLowerCase();
  if ([".md", ".markdown", ".txt"].includes(extension)) return "markdown";
  if (extension === ".json") return "json";
  if (extension === ".convcanvas") return "project";
  throw new CliError(EXIT.input, "UNSUPPORTED_INPUT", `不支持的输入格式：${extension || "无扩展名"}（可用 .md / .json / .convcanvas）`);
}

function newestMtime(directory) {
  let newest = statSync(directory).mtimeMs;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(path));
    else if (!/\.test\.[jt]sx?$/.test(entry.name)) newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
}

function newestRenderInput(root) {
  const inputs = ["src", "fixtures", "public", "render.html", "vite.config.ts", "package.json", "package-lock.json",
    "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json"];
  return Math.max(0, ...inputs.map((name) => {
    const path = join(root, name);
    if (!existsSync(path)) return 0;
    return statSync(path).isDirectory() ? newestMtime(path) : statSync(path).mtimeMs;
  }));
}

const BUILD_STAMP = ".convoscroll-build-complete";

/** A render.html left by an interrupted/failed build is never a completed build. */
export function renderBuildIsStale(root = ROOT) {
  try {
    const dist = join(root, "dist-cli");
    if (!statSync(join(dist, "render.html")).isFile()) return true;
    if (readFileSync(join(dist, BUILD_STAMP), "utf8") !== "complete-v1\n") return true;
    return statSync(join(dist, BUILD_STAMP)).mtimeMs < newestRenderInput(root);
  } catch { return true; }
}

function ensureRenderBuild(log) {
  if (!renderBuildIsStale()) return;
  log("正在构建命令行渲染页…");
  const stamp = join(DIST, BUILD_STAMP);
  // Invalidate before invoking Vite, including failures before emptyOutDir runs.
  rmSync(stamp, { force: true });
  const inputsAtStart = newestRenderInput(ROOT);
  const result = spawnSync(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build", "--mode", "cli", "--logLevel", "error"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new CliError(EXIT.environment, "RENDER_BUILD_FAILED", `构建失败，请在 ${ROOT} 运行 npm run build:cli 查看原因。`, {
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(-2000),
    });
  }
  if (newestRenderInput(ROOT) !== inputsAtStart) {
    throw new CliError(EXIT.environment, "RENDER_BUILD_CHANGED", "构建期间源文件发生变化，请重新运行命令。");
  }
  try {
    if (!statSync(join(DIST, "render.html")).isFile()) throw new Error("render.html missing");
    const temporary = `${stamp}.tmp`;
    writeFileSync(temporary, "complete-v1\n");
    renameSync(temporary, stamp);
  } catch (error) {
    rmSync(stamp, { force: true });
    throw new CliError(EXIT.environment, "RENDER_BUILD_FAILED", `构建完成标记未能保存，请重新运行命令：${error.message}`);
  }
}

function contentType(path) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
    ".md": "text/markdown; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
  };
  return types[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

/** Resolves a Markdown `src` inside the input directory, following symlinks before the check. */
export function resolveLocalFile(inputDirectory, src) {
  if (src.includes("\0")) return { status: 400, reason: "路径无效" };
  let real;
  try {
    real = realpathSync(resolve(inputDirectory, src));
  } catch {
    return { status: 404 };
  }
  if (!isInside(inputDirectory, real)) return { status: 403, reason: "不能读取输入文件所在文件夹以外的文件" };
  const stats = statSync(real);
  if (!stats.isFile()) return { status: 403, reason: "不是文件" };
  if (stats.size > LOCAL_FILE_LIMIT) return { status: 413, reason: "文件太大了（单个最多 32 MB）" };
  return { status: 200, path: real };
}

/**
 * Serves the render page from dist-cli/, the input file, and files inside the input's
 * directory from one fake origin; every other request is aborted and recorded.
 */
export async function installRoutes(context, { input, inputDirectory, distRoot, blocked, protectedPaths }) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) {
      blocked.push(url.href);
      return route.abort("blockedbyclient");
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return route.fulfill({ status: 400, body: "路径无效" });
    }
    if (pathname === "/__convoscroll/input") {
      return route.fulfill({ status: 200, body: readFileSync(input), contentType: "application/octet-stream" });
    }
    if (pathname.startsWith("/__convoscroll/local/")) {
      const file = resolveLocalFile(inputDirectory, pathname.slice("/__convoscroll/local/".length));
      if (file.status !== 200) return route.fulfill({ status: file.status, body: file.reason ?? "" });
      protectedPaths?.add(file.path);
      return route.fulfill({ status: 200, body: readFileSync(file.path), contentType: contentType(file.path) });
    }
    const asset = resolve(distRoot, `.${pathname}`);
    let real;
    try {
      real = realpathSync(asset);
    } catch {
      return route.fulfill({ status: 404, body: "" });
    }
    if (!isInside(distRoot, real) || !statSync(real).isFile()) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, body: readFileSync(real), contentType: contentType(real) });
  });
}

export async function launchBrowser(name) {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    throw new CliError(EXIT.environment, "PLAYWRIGHT_MISSING", `缺少 playwright-core，请在 ${ROOT} 运行 npm install。`);
  }
  try {
    return await chromium.launch(name === "chrome" ? { channel: "chrome", headless: true } : { headless: true });
  } catch (error) {
    const hint = name === "chrome"
      ? "没有找到 Google Chrome。请先安装 Chrome，或者加 --browser chromium 改用 Playwright 自带的 Chromium（第一次要运行 npx playwright install chromium 下载）。"
      : "没有找到 Playwright 自带的 Chromium。请运行 npx playwright install chromium 下载，或者安装 Google Chrome 后去掉 --browser chromium。";
    throw new CliError(EXIT.environment, "BROWSER_UNAVAILABLE", hint, { cause: String(error?.message ?? error).split("\n")[0] });
  }
}

async function renderInBrowser(options, kind, log) {
  const inputDirectory = realpathSync(dirname(options.input));
  const distRoot = realpathSync(DIST);
  const blocked = [];
  const protectedPaths = new Set([options.input]);
  const browser = await launchBrowser(options.browser);
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
      locale: "zh-CN",
      serviceWorkers: "block",
    });
    await installRoutes(context, { input: options.input, inputDirectory, distRoot, blocked, protectedPaths });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${ORIGIN}/render.html`);
    await page.waitForFunction(() => Boolean(window.convoscroll), undefined, { timeout: 15_000 }).catch(() => {
      throw new CliError(EXIT.render, "RENDER_PAGE_FAILED", "页面没有启动。", { pageErrors });
    });
    log(options.command === "check" ? "正在检查…" : "正在渲染…");
    const response = await page.evaluate((request) => window.convoscroll.run(request), {
      mode: options.command,
      kind,
      fileName: basename(options.input),
      preset: options.preset,
      ...(options.scale ? { scale: options.scale } : {}),
      foldStrategy: options.fold,
      includeProject: Boolean(options.project),
    });
    return { response, blocked, protectedPaths: [...protectedPaths] };
  } finally {
    await browser.close();
  }
}

export function partPath(output, index, total) {
  if (total <= 1) return output;
  const base = output.replace(/\.png$/i, "");
  const digits = Math.max(2, String(total).length);
  return `${base}-part-${String(index + 1).padStart(digits, "0")}-of-${String(total).padStart(digits, "0")}.png`;
}

export async function main(argv) {
  const options = parseCli(argv);
  if (options.help) {
    console.log(USAGE);
    return EXIT.ok;
  }
  const log = (message) => { if (!options.json) console.error(message); };
  const kind = inputKind(options.input);
  let size;
  try {
    const stats = statSync(options.input);
    if (!stats.isFile()) throw new Error();
    size = stats.size;
  } catch {
    throw new CliError(EXIT.input, "INPUT_NOT_FOUND", `找不到输入文件：${options.input}`);
  }
  if (size > INPUT_LIMITS[kind]) throw new CliError(EXIT.input, "INPUT_TOO_LARGE", `输入文件太大了（最多 ${INPUT_LIMITS[kind] / MiB} MB）。`);

  ensureRenderBuild(log);
  const { response, blocked, protectedPaths } = await renderInBrowser(options, kind, log);

  if (!response.ok) {
    throw new CliError(response.stage === "input" ? EXIT.input : EXIT.render, response.code, response.message, {
      ...(response.path ? { path: response.path } : {}),
      ...(response.recommendation ? { recommendation: response.recommendation } : {}),
      ...(blocked.length ? { blockedRequests: blocked } : {}),
    });
  }

  const result = {
    ok: true,
    command: options.command,
    input: options.input,
    summary: response.summary,
    warnings: response.warnings,
    blockedRequests: blocked,
  };

  if (options.command === "render") {
    const output = options.output ?? options.input.replace(/\.[^./]+$/, "") + ".png";
    const files = response.parts.map((part) => ({
      path: partPath(output, part.index, response.parts.length),
      width: part.width,
      height: part.height,
      bytes: Buffer.from(part.base64, "base64"),
    }));
    try {
      writeOutputFiles([
        ...files,
        ...(options.project ? [{ path: options.project, bytes: Buffer.from(response.project, "base64") }] : []),
      ], protectedPaths);
    } catch (error) {
      if (error instanceof OutputFileError) throw new CliError(EXIT.render, error.code, error.message, error.details);
      throw error;
    }
    Object.assign(result, {
      files: files.map(({ path, width, height }) => ({ path, width, height })),
      ...(options.project ? { project: options.project } : {}),
      scale: response.scale,
      ...(response.singleImageScale ? { singleImageScale: response.singleImageScale } : {}),
      diagnostics: response.diagnostics.map(({ code, severity, message, recommendation }) => ({ code, severity, message, ...(recommendation ? { recommendation } : {}) })),
    });
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const { summary } = result;
    console.log(`《${summary.title}》：${summary.messageCount} 条消息，${summary.blockCount} 个内容块，${summary.assetCount} 个附件。`);
    for (const file of result.files ?? []) console.log(`PNG：${file.path}（${file.width}×${file.height}）`);
    if (result.project) console.log(`项目：${result.project}`);
    if (result.singleImageScale) console.log(`提示：内容较长，已拆成 ${result.files.length} 张。加 --scale ${result.singleImageScale} 可以合成一张，但没那么清楚。`);
    for (const diagnostic of result.diagnostics ?? []) {
      if (diagnostic.severity !== "info" && diagnostic.code !== "semantic-segmentation") console.log(`注意：${diagnostic.message}`);
    }
    for (const warning of result.warnings) console.log(`警告：${warning.message}`);
    if (blocked.length) console.log(`已拦截 ${blocked.length} 个外部请求：${blocked.slice(0, 3).join("、")}`);
    if (options.command === "check") console.log("检查通过。");
  }
  return EXIT.ok;
}

export function report(error, json) {
  const known = error instanceof CliError;
  const payload = {
    ok: false,
    code: known ? error.code : "UNEXPECTED",
    message: error.message,
    ...(known ? error.details : {}),
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    const where = payload.path ? `${payload.path} · ` : "";
    console.error(`错误（${payload.code}）：${where}${payload.message}`);
    if (payload.recommendation) console.error(`建议：${payload.recommendation}`);
    if (payload.output) console.error(payload.output);
    for (const item of payload.recovery ?? []) console.error(`待恢复：${item.path}${item.backup ? `；原文件备份：${item.backup}` : ""}`);
    for (const path of payload.cleanup ?? []) console.error(`待清理：${path}`);
  }
  return known ? error.exitCode : EXIT.render;
}
