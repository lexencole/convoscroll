import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockfilePath = join(projectRoot, "package-lock.json");
const outputPath = join(projectRoot, "public", "THIRD_PARTY_NOTICES.txt");
const mode = process.argv[2];

if (process.argv.length > 3 || (mode !== undefined && mode !== "--check")) {
  console.error(
    "Usage: node scripts/generate-third-party-notices.mjs [--check]",
  );
  process.exit(2);
}

const lockfileBytes = readFileSync(lockfilePath);
const lockfile = JSON.parse(lockfileBytes.toString("utf8"));

if (lockfile.lockfileVersion !== 3 || typeof lockfile.packages !== "object") {
  throw new Error(
    "Expected an npm package-lock.json with lockfileVersion 3 and a packages map.",
  );
}

const licenseFilePattern =
  /^(?:licen[cs]e|copying|notice|third[-_. ]party(?:[-_. ]notices?)?)(?:$|[._ -])/i;

const remarkMathLicenseText = `(The MIT License)

Copyright (c) Junyoung Choi <fluke8259@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// These two package tarballs declare MIT but omit the monorepo's top-level
// license file. Keep the exact version in the key so dependency upgrades must
// be reviewed instead of silently reusing an old repository notice.
const verifiedRepositoryLicenseFiles = new Map([
  ["rehype-katex@7.0.1", {
    name: "license",
    source: "https://github.com/remarkjs/remark-math/blob/main/license",
    text: remarkMathLicenseText,
  }],
  ["remark-math@6.0.0", {
    name: "license",
    source: "https://github.com/remarkjs/remark-math/blob/main/license",
    text: remarkMathLicenseText,
  }],
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeText(value) {
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
}

function formatLicense(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const licenses = value.map(formatLicense).filter(Boolean);
    return licenses.join(" OR ");
  }

  if (value && typeof value === "object" && "type" in value) {
    return formatLicense(value.type);
  }

  return "";
}

function formatPerson(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  const email = typeof value.email === "string" ? value.email.trim() : "";
  const url = typeof value.url === "string" ? value.url.trim() : "";

  return [name, email ? `<${email}>` : "", url ? `(${url})` : ""]
    .filter(Boolean)
    .join(" ");
}

function formatRepository(value) {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && typeof value.url === "string"
        ? value.url
        : "";

  return raw.trim().replace(/^git\+/, "");
}

function isPackageLockPath(packagePath) {
  return (
    packagePath.startsWith("node_modules/") ||
    packagePath.includes("/node_modules/")
  );
}

function resolvePackageDirectory(packagePath) {
  const packageDirectory = resolve(projectRoot, packagePath);
  const relativePath = relative(projectRoot, packageDirectory);

  if (
    relativePath.startsWith("..") ||
    !relativePath.split(/[\\/]/).includes("node_modules")
  ) {
    throw new Error(`Unsafe package path in package-lock.json: ${packagePath}`);
  }

  return packageDirectory;
}

function readLicenseFiles(packageDirectory) {
  return readdirSync(packageDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        (entry.isFile() || entry.isSymbolicLink()) &&
        licenseFilePattern.test(entry.name),
    )
    .map((entry) => ({
      name: entry.name,
      text: normalizeText(readFileSync(join(packageDirectory, entry.name), "utf8")),
    }))
    .sort((left, right) => compareText(left.name.toLowerCase(), right.name.toLowerCase()));
}

const packageLocations = Object.entries(lockfile.packages)
  .filter(
    ([packagePath, metadata]) =>
      packagePath !== "" &&
      isPackageLockPath(packagePath) &&
      metadata.dev !== true,
  )
  .sort(([left], [right]) => compareText(left, right));

const packagesByVersion = new Map();

for (const [packagePath, lockMetadata] of packageLocations) {
  const packageDirectory = resolvePackageDirectory(packagePath);
  const packageJsonPath = join(packageDirectory, "package.json");

  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `Production dependency is not installed; run npm ci before generating notices: ${packagePath}`,
    );
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const name = packageJson.name;
  const version = lockMetadata.version;

  if (typeof name !== "string" || !name || typeof version !== "string" || !version) {
    throw new Error(`Missing package name or version for ${packagePath}`);
  }

  if (packageJson.version !== version) {
    throw new Error(
      `Installed version does not match package-lock.json for ${name}: ${packageJson.version} != ${version}`,
    );
  }

  const lockLicense = formatLicense(lockMetadata.license);
  const installedLicense = formatLicense(packageJson.license);
  if (lockLicense && installedLicense && lockLicense !== installedLicense) {
    throw new Error(
      `License metadata does not match package-lock.json for ${name}@${version}: ${installedLicense} != ${lockLicense}`,
    );
  }

  const license = lockLicense || installedLicense;
  if (!license) {
    throw new Error(`Missing license metadata for ${name}@${version}`);
  }

  const key = `${name}\u0000${version}`;
  const bundledLicenseFiles = readLicenseFiles(packageDirectory);
  const verifiedRepositoryLicense = verifiedRepositoryLicenseFiles.get(`${name}@${version}`);
  const licenseFiles = bundledLicenseFiles.length > 0
    ? bundledLicenseFiles
    : verifiedRepositoryLicense
      ? [verifiedRepositoryLicense]
      : [];
  const existing = packagesByVersion.get(key);

  if (existing) {
    if (existing.license !== license) {
      throw new Error(`Conflicting license metadata for ${name}@${version}`);
    }

    existing.locations.push(packagePath);
    for (const licenseFile of licenseFiles) {
      const documentKey = `${licenseFile.name}\u0000${licenseFile.text}`;
      if (!existing.documentKeys.has(documentKey)) {
        existing.documentKeys.add(documentKey);
        existing.licenseFiles.push(licenseFile);
      }
    }
    continue;
  }

  packagesByVersion.set(key, {
    name,
    version,
    license,
    author: formatPerson(packageJson.author),
    repository: formatRepository(packageJson.repository),
    locations: [packagePath],
    licenseFiles,
    documentKeys: new Set(
      licenseFiles.map((file) => `${file.name}\u0000${file.text}`),
    ),
  });
}

const productionPackages = [...packagesByVersion.values()].sort(
  (left, right) =>
    compareText(left.name, right.name) || compareText(left.version, right.version),
);
const packagesWithoutCompleteText = productionPackages.filter(
  (dependency) => dependency.licenseFiles.length === 0,
);
const lockfileHash = createHash("sha256").update(lockfileBytes).digest("hex");

const lines = [
  "THIRD-PARTY SOFTWARE NOTICES",
  "================================",
  "",
  "This file is generated from package-lock.json and the installed production",
  "dependency metadata under node_modules, plus locally vendored icon notices.",
  "Do not edit it by hand; run",
  "`npm run licenses:generate` after dependency changes.",
  "",
  "The notices below are provided for attribution and do not alter the terms of",
  "the applicable third-party licenses.",
  "",
  `package-lock.json SHA-256: ${lockfileHash}`,
  `Production package locations: ${packageLocations.length}`,
  `Unique production package versions: ${productionPackages.length}`,
  `Packages without complete license/notice text: ${packagesWithoutCompleteText.length}`,
  "",
];

for (const [index, dependency] of productionPackages.entries()) {
  lines.push(
    "===============================================================================",
    `${index + 1}. ${dependency.name}@${dependency.version}`,
    `License metadata: ${dependency.license}`,
  );

  if (dependency.repository) {
    lines.push(`Repository: ${dependency.repository}`);
  }

  if (dependency.author) {
    lines.push(`Package author: ${dependency.author}`);
  }

  lines.push(`Installed path${dependency.locations.length === 1 ? "" : "s"}:`);
  for (const location of dependency.locations.sort(compareText)) {
    lines.push(`- ${location}`);
  }

  if (dependency.licenseFiles.length === 0) {
    lines.push(
      "Bundled license/notice files: none",
      "",
      "The installed package does not include a top-level license or notice file.",
      "The license identifier above comes from package-lock.json/package.json;",
      "consult the linked package repository for the complete license notice.",
      "",
    );
    continue;
  }

  lines.push(
    `License/notice document${dependency.licenseFiles.length === 1 ? "" : "s"}: ${dependency.licenseFiles.map((file) => file.name).join(", ")}`,
    "",
  );

  for (const [fileIndex, licenseFile] of dependency.licenseFiles.entries()) {
    if (fileIndex > 0) {
      lines.push("-------------------------------------------------------------------------------", "");
    }
    lines.push(`[${licenseFile.name}]`);
    if (licenseFile.source) lines.push(`Verified source: ${licenseFile.source}`);
    lines.push("", licenseFile.text, "");
  }
}

lines.push(
  "===============================================================================",
  "Vendored model icons: LobeHub Icons (MIT)",
  "Source: https://github.com/lobehub/lobe-icons/tree/a94750e3f5f8fc33757b839d85030e742284e43a/packages/static-svg/icons",
  "Files: openai.svg, gemini.svg, claude.svg, deepseek.svg, kimi.svg, zai.svg, grok.svg",
  "Local paths: src/models/model-brand-paths.ts, src/models/vendor/LICENSE",
  "",
  normalizeText(readFileSync(join(projectRoot, "src/models/vendor/LICENSE"), "utf8")),
  "",
);

lines.push(
  "===============================================================================",
  "Vendored interface icons: lucide-static@1.61.0 (ISC; derived Feather icons under MIT)",
  "Source: https://www.npmjs.com/package/lucide-static/v/1.61.0",
  `Files: ${readdirSync(join(projectRoot, "src/app/icons")).filter((name) => name.endsWith(".svg")).sort().join(", ")}`,
  "Local paths: src/app/icons/, src/app/Icon.tsx",
  "",
  normalizeText(readFileSync(join(projectRoot, "src/app/icons/LICENSE"), "utf8")),
  "",
);

const generatedNotices = `${lines.join("\n").replace(/\n+$/g, "")}\n`;

if (mode === "--check") {
  const currentNotices = existsSync(outputPath)
    ? readFileSync(outputPath, "utf8")
    : "";

  if (currentNotices !== generatedNotices) {
    console.error(
      "public/THIRD_PARTY_NOTICES.txt is missing or stale. Run npm run licenses:generate.",
    );
    process.exit(1);
  }

  console.log(
    `Third-party notices are current (${productionPackages.length} unique production package versions).`,
  );
} else {
  writeFileSync(outputPath, generatedNotices, "utf8");
  console.log(
    `Wrote public/THIRD_PARTY_NOTICES.txt (${productionPackages.length} unique production package versions).`,
  );
}
