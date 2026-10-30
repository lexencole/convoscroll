import { describe, expect, it } from "vitest";
import { resolveModelBrand } from "./model-brand";

describe("resolveModelBrand", () => {
  it.each([
    ["ChatGPT 5", "openai"],
    ["GPT-4.1 mini", "openai"],
    ["o3", "openai"],
    ["Gemini 2.5 Pro", "gemini"],
    ["Claude 4 Sonnet", "claude"],
    ["DeepSeek-R1", "deepseek"],
    ["Kimi K2", "kimi"],
    ["Moonshot v1", "kimi"],
    ["GLM-4.5", "glm"],
    ["GLM", "glm"],
    ["智谱 GLM", "glm"],
    ["Grok 4", "grok"],
    ["xAI Grok", "grok"],
  ])("maps %s to %s", (model, brand) => {
    expect(resolveModelBrand(model)).toBe(brand);
  });

  it("does not guess an unknown model provider", () => {
    expect(resolveModelBrand("Atlas Demo 2.4")).toBeUndefined();
    expect(resolveModelBrand("MaxAI Assistant")).toBeUndefined();
    expect(resolveModelBrand("GLMish Demo")).toBeUndefined();
    expect(resolveModelBrand()).toBeUndefined();
  });
});
