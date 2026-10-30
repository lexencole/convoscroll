import type { ButtonHTMLAttributes, SVGProps } from "react";
import icon0 from "./icons/arrow-down.svg?raw";
import icon1 from "./icons/arrow-up.svg?raw";
import icon2 from "./icons/check.svg?raw";
import icon3 from "./icons/x.svg?raw";
import icon4 from "./icons/copy.svg?raw";
import icon5 from "./icons/file-text.svg?raw";
import icon6 from "./icons/download.svg?raw";
import icon7 from "./icons/upload.svg?raw";
import icon8 from "./icons/circle-alert.svg?raw";
import icon9 from "./icons/eye.svg?raw";
import icon10 from "./icons/pencil.svg?raw";
import icon11 from "./icons/info.svg?raw";
import icon12 from "./icons/list.svg?raw";
import icon13 from "./icons/list-ordered.svg?raw";
import icon14 from "./icons/ellipsis.svg?raw";
import icon15 from "./icons/plus.svg?raw";
import icon16 from "./icons/grip-vertical.svg?raw";
import icon17 from "./icons/image.svg?raw";
import icon18 from "./icons/paperclip.svg?raw";
import icon19 from "./icons/type.svg?raw";
import icon20 from "./icons/wrench.svg?raw";
import icon21 from "./icons/corner-down-right.svg?raw";
import icon22 from "./icons/braces.svg?raw";
import icon23 from "./icons/settings-2.svg?raw";
import icon24 from "./icons/code-xml.svg?raw";
import icon25 from "./icons/chevron-right.svg?raw";
import icon26 from "./icons/chevron-down.svg?raw";
import icon27 from "./icons/redo-2.svg?raw";
import icon28 from "./icons/sparkles.svg?raw";
import icon29 from "./icons/refresh-cw.svg?raw";
import icon30 from "./icons/trash-2.svg?raw";
import icon31 from "./icons/undo-2.svg?raw";
import icon32 from "./icons/bold.svg?raw";
import icon33 from "./icons/italic.svg?raw";
import icon34 from "./icons/strikethrough.svg?raw";
import icon35 from "./icons/circle-help.svg?raw";

const sources = {
  "arrow-down": icon0,
  "arrow-up": icon1,
  "check": icon2,
  "close": icon3,
  "copy": icon4,
  "document": icon5,
  "download": icon6,
  "upload": icon7,
  "error": icon8,
  "eye": icon9,
  "edit": icon10,
  "info": icon11,
  "list": icon12,
  "list-ordered": icon13,
  "more": icon14,
  "plus": icon15,
  "grip": icon16,
  "image": icon17,
  "paperclip": icon18,
  "text": icon19,
  "tool": icon20,
  "output": icon21,
  "braces": icon22,
  "settings": icon23,
  "code": icon24,
  "chevron-right": icon25,
  "chevron-down": icon26,
  "redo": icon27,
  "spark": icon28,
  "sync": icon29,
  "trash": icon30,
  "undo": icon31,
  "bold": icon32,
  "italic": icon33,
  "strike": icon34,
  "help": icon35,
} as const;
export type IconName = keyof typeof sources;

// Only the checked-in Lucide paths are inserted; no user-provided markup enters this component.
const paths = Object.fromEntries(Object.entries(sources).map(([name, svg]) => [name, (svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)?.[1] ?? "").replace(/>\s+</g, "><").trim()]));
export function Icon({ name, ...props }: { readonly name: IconName } & SVGProps<SVGSVGElement>) {
  return <svg {...props} className={`app-icon${props.className ? ` ${props.className}` : ""}`} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
    aria-hidden="true" dangerouslySetInnerHTML={{ __html: paths[name] }} />;
}

export function IconButton({
  icon,
  label,
  className,
  ...props
}: {
  readonly icon: IconName;
  readonly label: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children">) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={`icon-button${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} />
    </button>
  );
}
