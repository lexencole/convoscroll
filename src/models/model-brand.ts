export type ModelBrand =
  | "openai"
  | "gemini"
  | "claude"
  | "deepseek"
  | "kimi"
  | "glm"
  | "grok";

export const modelBrandLabels: Record<ModelBrand, string> = {
  openai: "ChatGPT / OpenAI",
  gemini: "Gemini",
  claude: "Claude",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  glm: "GLM",
  grok: "Grok",
};

function compact(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[\s._-]+/g, "");
}

export function resolveModelBrand(model?: string): ModelBrand | undefined {
  if (!model?.trim()) return undefined;
  const value = compact(model);

  if (value.includes("deepseek")) return "deepseek";
  if (value.includes("claude") || value.includes("anthropic")) return "claude";
  if (value.includes("gemini") || value.includes("googlebard")) return "gemini";
  if (value.includes("moonshot") || value.includes("kimi")) return "kimi";
  if (value.includes("chatglm") || value.includes("zhipu") || value.includes("智谱") || /^glm(?:\d|$)/.test(value)) return "glm";
  if (value.includes("grok") || value === "xai" || value.startsWith("xaigrok")) return "grok";
  if (
    value.includes("chatgpt")
    || value.includes("openai")
    || /^(gpt|o[1345](?:mini|pro|preview)?)/.test(value)
  ) return "openai";

  return undefined;
}
