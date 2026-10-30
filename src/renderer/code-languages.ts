/** Local grammar modules shared by the editor, canvas and offline renderer. */
const languages = [
  { value: "python", label: "Python", load: () => import("@shikijs/langs/python") },
  { value: "javascript", label: "JavaScript", load: () => import("@shikijs/langs/javascript") },
  { value: "typescript", label: "TypeScript", load: () => import("@shikijs/langs/typescript") },
  { value: "jsx", label: "JSX", load: () => import("@shikijs/langs/jsx") },
  { value: "tsx", label: "TSX", load: () => import("@shikijs/langs/tsx") },
  { value: "json", label: "JSON", load: () => import("@shikijs/langs/json") },
  { value: "html", label: "HTML", load: () => import("@shikijs/langs/html") },
  { value: "css", label: "CSS", load: () => import("@shikijs/langs/css") },
  { value: "sql", label: "SQL", load: () => import("@shikijs/langs/sql") },
  { value: "bash", label: "Shell / Bash", load: () => import("@shikijs/langs/bash") },
  { value: "c", label: "C", load: () => import("@shikijs/langs/c") },
  { value: "cpp", label: "C++", load: () => import("@shikijs/langs/cpp") },
  { value: "csharp", label: "C#", load: () => import("@shikijs/langs/csharp") },
  { value: "java", label: "Java", load: () => import("@shikijs/langs/java") },
  { value: "go", label: "Go", load: () => import("@shikijs/langs/go") },
  { value: "rust", label: "Rust", load: () => import("@shikijs/langs/rust") },
  { value: "swift", label: "Swift", load: () => import("@shikijs/langs/swift") },
  { value: "kotlin", label: "Kotlin", load: () => import("@shikijs/langs/kotlin") },
  { value: "php", label: "PHP", load: () => import("@shikijs/langs/php") },
  { value: "ruby", label: "Ruby", load: () => import("@shikijs/langs/ruby") },
  { value: "r", label: "R", load: () => import("@shikijs/langs/r") },
  { value: "yaml", label: "YAML", load: () => import("@shikijs/langs/yaml") },
  { value: "xml", label: "XML", load: () => import("@shikijs/langs/xml") },
  { value: "markdown", label: "Markdown", load: () => import("@shikijs/langs/markdown") },
  { value: "dockerfile", label: "Dockerfile", load: () => import("@shikijs/langs/dockerfile") },
  { value: "powershell", label: "PowerShell", load: () => import("@shikijs/langs/powershell") },
  { value: "lua", label: "Lua", load: () => import("@shikijs/langs/lua") },
  { value: "dart", label: "Dart", load: () => import("@shikijs/langs/dart") },
  { value: "toml", label: "TOML", load: () => import("@shikijs/langs/toml") },
];

export const codeLanguageOptions = [
  { value: "text", label: "纯文本" },
  ...languages.map(({ value, label }) => ({ value, label })),
];
export const supportedLanguages = new Set<string>(languages.map(({ value }) => value));

export async function loadCodeLanguages(requested: readonly string[]) {
  const selected = new Set(requested.map(normalizeLanguage));
  return (await Promise.all(languages.filter(({ value }) => selected.has(value)).map(({ load }) => load())))
    .flatMap(module => module.default);
}

const aliases: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", py: "python", python3: "python",
  sh: "bash", shell: "bash", zsh: "bash", yml: "yaml", md: "markdown",
  "c++": "cpp", cc: "cpp", cxx: "cpp", "c#": "csharp", cs: "csharp", dotnet: "csharp",
  golang: "go", rs: "rust", rb: "ruby", kt: "kotlin", kts: "kotlin", ps1: "powershell", pwsh: "powershell",
  htm: "html", xhtml: "html", docker: "dockerfile", txt: "text", plain: "text", plaintext: "text",
};

export function normalizeLanguage(language?: string): string {
  const normalized = language?.trim().toLowerCase() || "text";
  return Object.hasOwn(aliases, normalized) ? aliases[normalized] : normalized;
}
