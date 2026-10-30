import { useUiText } from "../i18n/LocaleContext";
import { Icon, IconButton } from "./Icon";
import { WorkbenchItemMenu } from "../editor/WorkbenchItemMenu";
export const editingHelp = "很简单的啦~  ʕ •ᴥ•ʔ";

export function WorkbenchToolbar({ hostRef, barRef, active, hidden, blocked, canUndo, canRedo, onUndo, onRedo, onHelp }: {
  hostRef: (host: HTMLDivElement | null) => void; barRef: (bar: HTMLDivElement | null) => void;
  active: boolean; hidden: boolean; blocked: boolean; canUndo: boolean; canRedo: boolean;
  onUndo: () => void; onRedo: () => void; onHelp: () => void;
}) {
  const t = useUiText();
  return <div className="inline-toolbar" ref={barRef} hidden={hidden} aria-label={t("编辑工具栏")}>
    <div className="inline-toolbar-host" ref={hostRef} />
    {!active ? <div className="inline-format-tools" role="group" aria-label={t("文字格式")}>
      <button className="inline-format-placeholder" type="button" disabled aria-label={t("段落样式")}>{t("正文")}<Icon name="chevron-down" /></button>
      <IconButton icon="bold" label={t("加粗")} disabled />
      <IconButton icon="italic" label={t("斜体")} className="inline-format-italic" disabled />
      <WorkbenchItemMenu label={t("更多编辑操作")} title={t("编辑帮助")} disabled={blocked}
        actions={[{ label: "编辑帮助", icon: "help", group: "help", run: onHelp }]} />
    </div> : null}
    <div className="inline-history-tools">
      <IconButton icon="undo" label={t("撤销")} disabled={!canUndo || blocked} onClick={onUndo} />
      <IconButton icon="redo" label={t("重做")} disabled={!canRedo || blocked} onClick={onRedo} />
    </div>
  </div>;
}
