import { useState } from "react";
import "../styles/lab.css";
import type { CanvasSettings, ConversationDocument } from "../data/conversation-types";
import { getFixture } from "../data/fixtures";
import { ConversationCanvas } from "../renderer/ConversationCanvas";
import {
  buildThemeTokens,
  createThemeDraft,
  getThemePreset,
  themePresets,
  themeStyle,
  type AccentPalette,
  type BodyScale,
  type CornerStyle,
  type Density,
  type HeadingStyle,
  type LineHeight,
  type SurfaceStyle,
  type ThemeAdjustments,
  type ThemeDraft,
  type ThemePresetId,
} from "../theme/theme-presets";
import { PreviewStage } from "./PreviewStage";
import { SelectField } from "./SelectField";
import {
  clearLabSelection,
  loadLabSelection,
  saveLabSelection,
  type SavedLabSelection,
} from "../theme/lab-theme-storage";
import {
  buildTypographyCandidateStyle,
  getTypographyCandidate,
  typographyCandidates,
  type TypographyCandidate,
  type TypographyCandidateId,
} from "../theme/typography-candidates";

type LabView = "typography" | "single" | "presets" | "saved";
type CanvasPreset = CanvasSettings["preset"];

const richFixture = getFixture("rich");

const canvasSettings: Record<CanvasPreset, CanvasSettings> = {
  portrait: { preset: "portrait", width: 480, scale: 3 },
  wide: { preset: "wide", width: 720, scale: 2 },
};

function labDocument(
  document: ConversationDocument,
  preset: CanvasPreset,
  themeId: string,
): ConversationDocument {
  return {
    ...document,
    canvas: canvasSettings[preset],
    theme: { id: themeId },
  };
}

const typographyBlockIds = new Set([
  "block-rich-003-markdown",
  "block-rich-009-markdown-code",
  "block-rich-010-markdown-math-table",
]);

function typographyLabDocument(document: ConversationDocument): ConversationDocument {
  const messages = document.messages
    .filter((message) => message.id === "msg-rich-003-user" || message.id === "msg-rich-004-assistant-analysis")
    .map((message) => ({
      ...message,
      blocks: message.blocks.filter((block) => typographyBlockIds.has(block.id)),
    }));

  return {
    ...document,
    metadata: {
      ...document.metadata,
      title: "中英文字体对照",
      subtitle: "同一份 Rich 内容，只比较字体、字重、字号、字距和行高。",
    },
    messages,
  };
}

interface ThemePreviewCardProps {
  readonly draft: ThemeDraft;
  readonly document: ConversationDocument;
  readonly canvasPreset: CanvasPreset;
  readonly label?: string;
}

function ThemePreviewCard({ draft, document, canvasPreset, label }: ThemePreviewCardProps) {
  const preset = getThemePreset(draft.presetId);
  const tokens = buildThemeTokens(draft);
  const themedDocument = labDocument(document, canvasPreset, `lab-${draft.presetId}`);

  return (
    <article className="lab-preview-card" data-theme-preview={draft.presetId}>
      <header className="lab-preview-card__header">
        <span
          className="lab-preview-card__swatch"
          style={{ background: tokens["--color-accent"] }}
          aria-hidden="true"
        />
        <div>
          <span>{label ?? "候选方向"}</span>
          <strong>{preset.name}{draft.isCustom ? " · 自定义" : ""}</strong>
        </div>
        <small>{themedDocument.canvas.width}px</small>
      </header>
      <PreviewStage canvasWidth={themedDocument.canvas.width} className="lab-preview-stage">
        <div
          className="lab-theme-scope"
          data-lab-theme={draft.presetId}
        >
          <ConversationCanvas document={themedDocument} themeStyle={themeStyle(draft)} />
        </div>
      </PreviewStage>
    </article>
  );
}

function TypographyPreviewCard({
  candidate,
  document,
}: {
  readonly candidate: TypographyCandidate;
  readonly document: ConversationDocument;
}) {
  const themedDocument = labDocument(document, "portrait", `lab-typography-${candidate.id}`);

  return (
    <article className="lab-preview-card lab-typography-preview" data-typography-preview={candidate.id}>
      <header className="lab-preview-card__header lab-typography-preview__header">
        <span className="lab-typography-marker" aria-hidden="true">{candidate.marker}</span>
        <div>
          <span>当前实际画布</span>
          <strong>{candidate.name}</strong>
        </div>
        <small>Portrait · 480px</small>
      </header>
      <PreviewStage canvasWidth={themedDocument.canvas.width} className="lab-preview-stage lab-typography-stage">
        <div className="lab-theme-scope" data-lab-typography={candidate.id}>
          <ConversationCanvas
            document={themedDocument}
            themeStyle={buildTypographyCandidateStyle(candidate.id)}
          />
        </div>
      </PreviewStage>
    </article>
  );
}

interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
}

function ControlSelect<T extends string>({
  id,
  label,
  hint,
  value,
  choices,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly value: T;
  readonly choices: readonly Choice<T>[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <div className="lab-control">
      <span><label htmlFor={id}>{label}</label><small>{hint}</small></span>
      <SelectField
        id={id}
        value={value}
        options={choices}
        onChange={onChange}
      />
    </div>
  );
}

const densityChoices: readonly Choice<Density>[] = [
  { value: "compact", label: "紧凑" },
  { value: "balanced", label: "平衡" },
  { value: "airy", label: "舒展" },
];
const bodyScaleChoices: readonly Choice<BodyScale>[] = [
  { value: "small", label: "小 · 14px" },
  { value: "standard", label: "标准 · 15px" },
  { value: "large", label: "大 · 16px" },
];
const lineHeightChoices: readonly Choice<LineHeight>[] = [
  { value: "balanced", label: "平衡 · 1.62" },
  { value: "relaxed", label: "舒展 · 1.76" },
];
const headingChoices: readonly Choice<HeadingStyle>[] = [
  { value: "sans", label: "系统无衬线" },
  { value: "editorial", label: "系统衬线" },
];
const cornerChoices: readonly Choice<CornerStyle>[] = [
  { value: "precise", label: "利落" },
  { value: "balanced", label: "平衡" },
  { value: "soft", label: "柔和" },
];
const accentChoices: readonly Choice<AccentPalette>[] = [
  { value: "forest", label: "Forest" },
  { value: "blue", label: "Technical Blue" },
  { value: "plum", label: "Muted Plum" },
];
const surfaceChoices: readonly Choice<SurfaceStyle>[] = [
  { value: "open", label: "开放文章 · 只保留左侧阅读线" },
  { value: "defined", label: "清晰卡片 · 完整描边" },
  { value: "soft", label: "悬浮柔面 · 轻阴影" },
];

function readSavedSelection(): SavedLabSelection | null {
  return typeof window === "undefined" ? null : loadLabSelection(window.localStorage);
}

function formatSavedAt(savedAt: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(savedAt));
}

export function LabApp() {
  const [restoredSelection] = useState(readSavedSelection);
  const [view, setView] = useState<LabView>("typography");
  const [typographyCandidateId, setTypographyCandidateId] =
    useState<TypographyCandidateId>("apple-clean");
  const [canvasPreset, setCanvasPreset] = useState<CanvasPreset>(
    restoredSelection?.canvasPreset ?? "portrait",
  );
  const [draft, setDraft] = useState<ThemeDraft>(
    restoredSelection?.draft ?? createThemeDraft("warm-editorial"),
  );
  const [savedSelection, setSavedSelection] = useState<SavedLabSelection | null>(
    restoredSelection,
  );
  const [saveFeedback, setSaveFeedback] = useState(
    restoredSelection ? `已恢复 ${formatSavedAt(restoredSelection.savedAt)} 保存的方案。` : "尚未保存",
  );

  if (richFixture.status !== "valid") {
    return <main className="lab-shell"><p>Rich 示例加载失败，Lab 无法显示。</p></main>;
  }

  const selectPreset = (presetId: ThemePresetId) => {
    setDraft(createThemeDraft(presetId));
    setSaveFeedback("已切换基线，当前更改尚未保存。");
    setView("single");
  };

  const updateAdjustment = <Key extends keyof ThemeAdjustments>(
    key: Key,
    value: ThemeAdjustments[Key],
  ) => {
    setDraft((current) => ({
      ...current,
      isCustom: true,
      adjustments: { ...current.adjustments, [key]: value },
    }));
    setSaveFeedback("正在编辑，当前更改尚未保存。");
  };

  const saveCurrentSelection = () => {
    try {
      const selection = saveLabSelection(window.localStorage, draft, canvasPreset);
      setSavedSelection(selection);
      setSaveFeedback(`已于 ${formatSavedAt(selection.savedAt)} 保存到此浏览器。`);
    } catch {
      setSaveFeedback("保存失败：当前浏览器不允许使用本地存储。");
    }
  };

  const restoreSavedSelection = () => {
    if (!savedSelection) return;
    setDraft(savedSelection.draft);
    setCanvasPreset(savedSelection.canvasPreset);
    setView("single");
    setSaveFeedback(`已载入 ${formatSavedAt(savedSelection.savedAt)} 保存的方案。`);
  };

  const removeSavedSelection = () => {
    try {
      clearLabSelection(window.localStorage);
      setSavedSelection(null);
      setSaveFeedback("已清除浏览器中的已保存方案。");
      if (view === "saved") setView("single");
    } catch {
      setSaveFeedback("清除失败：当前浏览器不允许使用本地存储。");
    }
  };

  const resetCurrentPreset = () => {
    setDraft(createThemeDraft(draft.presetId));
    setSaveFeedback("已恢复当前方向的基线，尚未保存。");
  };

  const resetComfortBaseline = () => {
    setDraft(createThemeDraft("warm-editorial"));
    setSaveFeedback("已恢复“舒服阅读”基线，尚未保存。");
    setView("single");
  };

  const currentPreset = getThemePreset(draft.presetId);
  const typographyDocument = typographyLabDocument(richFixture.document);
  const activeTypographyCandidate = getTypographyCandidate(typographyCandidateId);

  return (
    <main className="lab-shell">
      <header className="lab-header">
        <div>
          <a className="lab-back-link" href="/">← 返回正式工作台</a>
          <span className="workspace-header__eyebrow">开发工具 · Visual Lab</span>
          <h1>主题和字体对照</h1>
          <p>
            A / B / C 使用相同的配色、圆角、卡片和代码主题，只比较字体、字重、
            字号、字距和行高。点击候选切换下方的画布。
          </p>
        </div>
        <aside className="lab-font-note">
          <strong>说明</strong>
          <span>只用本机系统字体。A 就是正式主题的字体设置，B、C 仅作对照。</span>
        </aside>
      </header>

      <section className="lab-command-bar" aria-label="Visual Lab view settings">
        <div className="lab-segmented lab-segmented--views" aria-label="Preview mode">
          <button type="button" className={view === "typography" ? "is-active" : undefined} onClick={() => setView("typography")}>字体对比</button>
          <button type="button" className={view === "presets" ? "is-active" : undefined} onClick={() => setView("presets")}>三方向</button>
          <button type="button" className={view === "single" ? "is-active" : undefined} onClick={() => setView("single")}>精调</button>
          <button type="button" className={view === "saved" ? "is-active" : undefined} disabled={!savedSelection} onClick={() => setView("saved")}>已保存</button>
        </div>
        {view === "typography" ? (
          <span className="lab-canvas-lock">字体对比固定 Portrait · 480</span>
        ) : (
          <div className="lab-segmented" aria-label="Canvas preset">
            <button type="button" className={canvasPreset === "portrait" ? "is-active" : undefined} onClick={() => setCanvasPreset("portrait")}>Portrait · 480</button>
            <button type="button" className={canvasPreset === "wide" ? "is-active" : undefined} onClick={() => setCanvasPreset("wide")}>Wide · 720</button>
          </div>
        )}
      </section>

      {view === "typography" ? (
        <section className="lab-typography-layout" aria-label="Typography comparison">
          <header className="lab-typography-intro">
            <div>
              <span>正式选择</span>
              <h2>正式主题使用 A · Apple Clean</h2>
              <p>点击 B 或 C 只改变这里的预览，不影响正式主题。</p>
            </div>
            <aside>
                <strong>当前字号</strong>
                <span>正文 16px / 1.68，标题 20 / 18 / 17px，代码 12px。</span>
            </aside>
          </header>

          <div className="lab-typography-options" aria-label="Typography candidates">
            {typographyCandidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={candidate.id === typographyCandidateId
                  ? "lab-typography-option is-active"
                  : "lab-typography-option"}
                aria-pressed={candidate.id === typographyCandidateId}
                onClick={() => setTypographyCandidateId(candidate.id)}
              >
                <span className="lab-typography-marker" aria-hidden="true">{candidate.marker}</span>
                <span className="lab-typography-option__copy">
                  <span
                    className="lab-typography-option__specimen"
                    style={{
                      fontFamily: candidate.tokens["--font-family-display"],
                      fontWeight: candidate.tokens["--font-weight-display"],
                      letterSpacing: candidate.tokens["--content-heading-letter-spacing"],
                    }}
                  >
                    中文标题 Typography
                  </span>
                  <strong>{candidate.name}</strong>
                  <span>{candidate.description}</span>
                  <small>{candidate.familyLabel}</small>
                  <small>{candidate.metricsLabel}</small>
                  {candidate.note ? <em>{candidate.note}</em> : null}
                </span>
                <span className="lab-typography-option__state">
                  {candidate.id === typographyCandidateId ? "当前查看" : "点击查看"}
                </span>
              </button>
            ))}
          </div>

          <TypographyPreviewCard
            candidate={activeTypographyCandidate}
            document={typographyDocument}
          />
        </section>
      ) : null}

      {view !== "typography" ? <section className="lab-preset-strip" aria-label="Theme directions">
        {themePresets.map((preset) => {
          const tokens = buildThemeTokens(createThemeDraft(preset.id));
          return (
            <button
              key={preset.id}
              type="button"
              className={draft.presetId === preset.id ? "lab-preset-card is-active" : "lab-preset-card"}
              aria-pressed={draft.presetId === preset.id}
              onClick={() => selectPreset(preset.id)}
            >
              <span className="lab-preset-card__topline">
                <span className="lab-preset-card__swatches" aria-hidden="true">
                  <i style={{ background: tokens["--color-canvas"] }} />
                  <i style={{ background: tokens["--color-user"] }} />
                  <i style={{ background: tokens["--color-accent"] }} />
                </span>
                <small>{preset.shortName}</small>
              </span>
              <strong>{preset.name}</strong>
              <span>{preset.description}</span>
              <small>{preset.traits.join(" · ")}</small>
            </button>
          );
        })}
      </section> : null}

      {view === "presets" ? (
        <section className="lab-compare-grid" aria-label="Three theme comparison">
          {themePresets.map((preset, index) => (
            <ThemePreviewCard
              key={preset.id}
              draft={createThemeDraft(preset.id)}
              document={richFixture.document}
              canvasPreset={canvasPreset}
              label={`方向 0${index + 1}`}
            />
          ))}
        </section>
      ) : null}

      {view === "single" ? (
        <section className="lab-single-layout">
          <aside className="lab-controls">
            <header>
              <span>{draft.isCustom ? "自定义" : "基线"}</span>
              <h2>{currentPreset.name}</h2>
              <p>
                {draft.isCustom
                  ? "这是从当前视觉方向派生的自定义方案。"
                  : "当前是可直接修改的基线；第一次改动后会自动成为自定义方案。"}
              </p>
            </header>

            <div className="lab-control-groups">
              <section className="lab-control-section">
                <header>
                  <strong>阅读节奏</strong>
                  <small>先判断手机上是否挤、字是否累。</small>
                </header>
                <div className="lab-control-grid">
                  <ControlSelect id="lab-density" label="信息密度" hint="影响消息间距和内边距" value={draft.adjustments.density} choices={densityChoices} onChange={(value) => updateAdjustment("density", value)} />
                  <ControlSelect id="lab-body-scale" label="正文大小" hint="同时联动标题与代码字号" value={draft.adjustments.bodyScale} choices={bodyScaleChoices} onChange={(value) => updateAdjustment("bodyScale", value)} />
                  <ControlSelect id="lab-line-height" label="正文行高" hint="影响长段落的纵向节奏" value={draft.adjustments.lineHeight} choices={lineHeightChoices} onChange={(value) => updateAdjustment("lineHeight", value)} />
                </div>
              </section>

              <section className="lab-control-section">
                <header>
                  <strong>组件层级</strong>
                  <small>决定它更像文章、卡片还是柔和对话。</small>
                </header>
                <div className="lab-control-grid">
                  <ControlSelect id="lab-heading" label="标题字体" hint="只改变标题，不替换正文字体" value={draft.adjustments.headingStyle} choices={headingChoices} onChange={(value) => updateAdjustment("headingStyle", value)} />
                  <ControlSelect id="lab-corners" label="圆角语言" hint="影响消息外层、内部卡片和附件" value={draft.adjustments.cornerStyle} choices={cornerChoices} onChange={(value) => updateAdjustment("cornerStyle", value)} />
                  <ControlSelect id="lab-surface" label="Assistant 分离" hint="最直接影响问答分离感" value={draft.adjustments.surface} choices={surfaceChoices} onChange={(value) => updateAdjustment("surface", value)} />
                </div>
              </section>

              <section className="lab-control-section">
                <header>
                  <strong>颜色气质</strong>
                  <small>最后再决定强调色，不会改动信息结构。</small>
                </header>
                <div className="lab-control-grid">
                  <ControlSelect id="lab-accent" label="强调色" hint="影响用户气泡、状态与阅读线" value={draft.adjustments.accent} choices={accentChoices} onChange={(value) => updateAdjustment("accent", value)} />
                </div>
              </section>
            </div>

            <div className="lab-control-actions">
              <button type="button" className="lab-button lab-button--primary" onClick={saveCurrentSelection}>保存当前方案</button>
              <div className="lab-button-row">
                <button type="button" className="lab-button" onClick={resetCurrentPreset}>恢复当前方向</button>
                <button type="button" className="lab-button" onClick={resetComfortBaseline}>恢复舒服阅读</button>
              </div>
            </div>

            <div className={savedSelection ? "lab-save-status is-saved" : "lab-save-status"} aria-live="polite">
              <strong>{savedSelection ? "浏览器中已有保存" : "本地保存"}</strong>
              <span>{saveFeedback}</span>
              {savedSelection ? (
                <div className="lab-save-status__actions">
                  <button type="button" onClick={restoreSavedSelection}>载入已保存</button>
                  <button type="button" onClick={removeSavedSelection}>清除</button>
                </div>
              ) : null}
            </div>
          </aside>
          <ThemePreviewCard draft={draft} document={richFixture.document} canvasPreset={canvasPreset} label="当前方案" />
        </section>
      ) : null}

      {view === "saved" && savedSelection ? (
        <section className="lab-saved-grid" aria-label="Saved A B comparison">
          <ThemePreviewCard draft={draft} document={richFixture.document} canvasPreset={canvasPreset} label="A · 当前" />
          <ThemePreviewCard draft={savedSelection.draft} document={richFixture.document} canvasPreset={savedSelection.canvasPreset} label={`B · 已保存 ${formatSavedAt(savedSelection.savedAt)}`} />
        </section>
      ) : null}
    </main>
  );
}
