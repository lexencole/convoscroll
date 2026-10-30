import { modelBrandLabels, resolveModelBrand } from "./model-brand";
import { modelBrandPaths } from "./model-brand-paths";
import "./model-brand.css";

export function ModelBrandIcon({ model, className }: {
  readonly model?: string;
  readonly className?: string;
}) {
  const brand = resolveModelBrand(model);
  if (!brand) return null;

  return (
    <svg
      className={["model-brand-icon", className].filter(Boolean).join(" ")}
      viewBox="0 0 24 24"
      fillRule="evenodd"
      role="img"
      aria-label={modelBrandLabels[brand]}
      data-model-brand={brand}
    >
      {modelBrandPaths[brand].map((path) => <path key={path} d={path} />)}
    </svg>
  );
}
