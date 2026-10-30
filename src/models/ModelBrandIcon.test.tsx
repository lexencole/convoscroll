import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModelBrandIcon } from "./ModelBrandIcon";
import { modelBrandLabels, type ModelBrand } from "./model-brand";
import { modelBrandPaths } from "./model-brand-paths";

describe("ModelBrandIcon", () => {
  it.each([
    ["ChatGPT", "openai"], ["Gemini", "gemini"], ["Claude", "claude"],
    ["DeepSeek", "deepseek"], ["Kimi", "kimi"], ["GLM", "glm"], ["Grok", "grok"],
  ] satisfies [string, ModelBrand][])("renders %s with its source geometry and fill rule", (model, brand) => {
    render(<ModelBrandIcon model={model} />);
    const icon = screen.getByRole("img", { name: modelBrandLabels[brand] });
    expect(icon).toHaveAttribute("viewBox", "0 0 24 24");
    expect(icon).toHaveAttribute("fill-rule", "evenodd");
    expect([...icon.querySelectorAll("path")].map((path) => path.getAttribute("d")))
      .toEqual(modelBrandPaths[brand]);
  });

  it("leaves unknown models to the caller's fallback", () => {
    const { container } = render(<ModelBrandIcon model="Atlas Demo" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("uses the pinned Z.ai mark for GLM rather than the legacy ChatGLM elephant", () => {
    expect(modelBrandPaths.glm).toEqual([
      "M12.105 2L9.927 4.953H.653L2.83 2h9.276zM23.254 19.048L21.078 22h-9.242l2.174-2.952h9.244zM24 2L9.264 22H0L14.736 2H24z",
    ]);
  });
});
