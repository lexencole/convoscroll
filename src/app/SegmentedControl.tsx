import { useRef, type CSSProperties, type ReactNode } from "react";

interface Option<Value extends string> { readonly value: Value; readonly label: ReactNode }
export function SegmentedControl<Value extends string>({ label, value, options, disabled, onChange }: {
  label: string; value: Value; options: readonly Option<Value>[]; disabled?: boolean; onChange: (value: Value) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  return <div className="segmented-control" ref={root} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}
    style={{ "--segment-count": options.length, "--segment-index": Math.max(0, options.findIndex((option) => option.value === value)) } as CSSProperties}>
    <span className="segmented-control__selection" aria-hidden="true" />
    {options.map((option, index) => <button key={option.value} type="button" role="radio" aria-checked={option.value === value}
      tabIndex={option.value === value ? 0 : -1} disabled={disabled} onClick={() => onChange(option.value)}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
          : (index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + options.length) % options.length;
        onChange(options[next].value);
        root.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
      }}>{option.label}</button>)}
  </div>;
}
