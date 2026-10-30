import * as fs from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export class OutputFileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function maybeStat(path, io) {
  try { return io.lstatSync(path); } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

// Resolve existing parent aliases even when the final directory does not exist.
function canonicalPath(path, io) {
  const suffix = [];
  let current = resolve(path);
  while (!maybeStat(current, io)) {
    suffix.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) throw new Error(`无法解析输出路径：${path}`);
    current = parent;
  }
  return join(io.realpathSync(current), ...suffix);
}

function sameFile(a, b) { return a && b && a.dev === b.dev && a.ino === b.ino; }
function contains(parent, child) {
  const path = relative(parent, child);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
}

/** Write a complete output set or restore the previous files after an ordinary I/O failure.
 * Staging and backups live beside each target. This is rollback, not a cross-file
 * atomic transaction: process termination or power loss may require the backups.
 * `io` permits deterministic disk-failure tests without touching real user files.
 */
export function writeOutputFiles(files, protectedPaths, io = fs) {
  const entries = [];
  let committed = false;
  try {
    const protectedFiles = protectedPaths.map((path) => ({ path: canonicalPath(path, io), stat: io.statSync(path) }));
    for (const file of files) {
      const path = resolve(file.path);
      const stat = maybeStat(path, io);
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) {
        throw new OutputFileError("INVALID_OUTPUT_TARGET", `输出位置必须是普通文件，不能是目录或符号链接：${path}`);
      }
      const canonical = canonicalPath(path, io);
      if (protectedFiles.some((input) => input.path === canonical || sameFile(input.stat, stat))) {
        throw new OutputFileError("OUTPUT_INPUT_COLLISION", `输出位置与输入文件或附件相同：${path}`);
      }
      if (entries.some((entry) => entry.canonical === canonical || sameFile(entry.stat, stat)
        || contains(entry.canonical, canonical) || contains(canonical, entry.canonical))) {
        throw new OutputFileError("OUTPUT_PATH_COLLISION", `多个输出位置相互冲突：${path}`);
      }
      entries.push({ ...file, path, canonical, stat, installed: false, originalMoved: false });
    }

    // Finish every write before replacing any destination.
    for (const entry of entries) {
      io.mkdirSync(dirname(entry.path), { recursive: true });
      entry.work = io.mkdtempSync(join(dirname(entry.path), ".convoscroll-output-"));
      entry.staged = join(entry.work, "new");
      entry.backup = join(entry.work, "previous");
      io.writeFileSync(entry.staged, entry.bytes, { flag: "wx", mode: entry.stat?.mode ?? 0o666 });
    }
    for (const entry of entries) {
      const now = maybeStat(entry.path, io);
      if (canonicalPath(entry.path, io) !== entry.canonical
        || Boolean(now) !== Boolean(entry.stat)
        || (now && (!now.isFile() || now.isSymbolicLink() || !sameFile(now, entry.stat)
          || now.size !== entry.stat.size || now.mtimeMs !== entry.stat.mtimeMs))) {
        throw new Error(`输出位置在生成期间发生变化：${entry.path}`);
      }
      if (entry.stat) {
        io.renameSync(entry.path, entry.backup);
        entry.originalMoved = true;
      }
      io.renameSync(entry.staged, entry.path);
      entry.installed = true;
    }
    committed = true;
  } catch (error) {
    const recovery = [];
    for (const entry of [...entries].reverse()) {
      try {
        if (entry.installed) io.unlinkSync(entry.path);
        if (entry.originalMoved) io.renameSync(entry.backup, entry.path);
      } catch {
        recovery.push({ path: entry.path, backup: entry.originalMoved ? entry.backup : undefined });
      }
    }
    const cleanup = [];
    for (const entry of entries) {
      if (!entry.work || recovery.some((item) => item.path === entry.path)) continue;
      try { io.rmSync(entry.work, { recursive: true, force: true }); } catch { cleanup.push(entry.work); }
    }
    if (recovery.length || cleanup.length) {
      throw new OutputFileError("OUTPUT_RECOVERY_FAILED", "输出失败，部分文件需要手动恢复或清理。请保留列出的备份。", {
        cause: error.message, recovery, cleanup,
      });
    }
    if (error instanceof OutputFileError) throw error;
    throw new OutputFileError("OUTPUT_WRITE_FAILED", `输出文件写入失败，已恢复原有文件：${error.message}`);
  }
  if (committed) {
    const cleanup = [];
    for (const entry of entries) {
      try { io.rmSync(entry.work, { recursive: true, force: true }); } catch { cleanup.push(entry.work); }
    }
    if (cleanup.length) throw new OutputFileError("OUTPUT_CLEANUP_FAILED", "输出已写入，但临时备份未能清理。", { committed: true, cleanup });
  }
}
