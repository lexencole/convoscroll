// Headless render page for `convoscroll render`. It mounts the
// same ConversationCanvas inside the same stage as the web workbench and runs
// the same export session, so command-line PNGs match web exports.
import { StrictMode, createRef, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "../styles/fonts.css";
import { PreviewStage } from "../app/PreviewStage";
import type { ConversationAsset, ConversationDocument } from "../data/conversation-types";
import { resolveFixtureAsset } from "../data/fixtures";
import { runPngExportSession } from "../export/export-session";
import { PngExportError, type ExportDiagnostic, type ExportFoldStrategy, type PngExportSettings } from "../export/export-types";
import { exportProjectPackage } from "../project/project-export";
import { ProjectFormatError, type ProjectWarning } from "../project/project-format";
import { ConversationCanvas, type AssetSourceResolver } from "../renderer/ConversationCanvas";
import type { ExportPresentation } from "../renderer/ExportPresentationContext";
import { loadRenderSource, type RenderInputKind, type RenderInputReader } from "./render-input";
// Stylesheet order mirrors main.tsx + App.tsx so the cascade is identical.
import "../styles/inline-editor.css";
import "../styles/tokens.css";
import "../styles/global.css";
import "../styles/editor.css";
import "../styles/workbench.css";

export interface RenderRequest {
  readonly mode: "check" | "render";
  readonly kind: RenderInputKind;
  readonly fileName: string;
  readonly preset: "portrait" | "wide";
  readonly scale?: 1 | 2 | 3;
  readonly foldStrategy: Exclude<ExportFoldStrategy, "preview">;
  readonly includeProject: boolean;
}

export interface RenderedPart {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly base64: string;
}

export type RenderResponse =
  | {
      readonly ok: true;
      readonly summary: { readonly title: string; readonly messageCount: number; readonly blockCount: number; readonly assetCount: number };
      readonly warnings: readonly ProjectWarning[];
      readonly parts?: readonly RenderedPart[];
      readonly scale?: number;
      /** Set when a lower scale would fit the whole conversation into one PNG. */
      readonly singleImageScale?: 1 | 2;
      readonly diagnostics?: readonly ExportDiagnostic[];
      readonly project?: string;
    }
  | {
      readonly ok: false;
      readonly stage: "input" | "render" | "project";
      readonly code: string;
      readonly message: string;
      readonly path?: string;
      readonly recommendation?: string;
    };

declare global {
  interface Window {
    convoscroll?: { readonly run: (request: RenderRequest) => Promise<RenderResponse> };
  }
}

interface HostState {
  readonly document: ConversationDocument;
  readonly resolveAssetSource: AssetSourceResolver;
  readonly presentation?: ExportPresentation;
}

type HostSetter = (update: (previous: HostState | undefined) => HostState | undefined) => void;

const canvasRef = createRef<HTMLElement>();
let hostSetter: HostSetter | undefined;
let markHostReady: () => void;
const hostReady = new Promise<void>((resolve) => { markHostReady = resolve; });

function RenderHost() {
  const [state, setState] = useState<HostState>();
  useLayoutEffect(() => {
    hostSetter = setState;
    markHostReady();
  }, []);
  if (!state) return null;
  // Same wrapper as the workbench stage in App.tsx so inherited styles match.
  return (
    <main className="workbench">
      <PreviewStage canvasWidth={state.presentation?.width ?? state.document.canvas.width} className="inline-canvas-stage">
        <ConversationCanvas
          ref={canvasRef}
          document={state.document}
          resolveAssetSource={state.resolveAssetSource}
          exportPresentation={state.presentation}
        />
      </PreviewStage>
    </main>
  );
}

const reader: RenderInputReader = {
  async readInput() {
    const response = await fetch("/__convoscroll/input");
    if (!response.ok) throw new ProjectFormatError("没有收到输入文件。", "INPUT_UNAVAILABLE");
    return new Uint8Array(await response.arrayBuffer());
  },
  async readLocal(src) {
    const response = await fetch(`/__convoscroll/local/${encodeURIComponent(src)}`);
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new ProjectFormatError(`读不到引用的文件：${src}（${await response.text()}）`, "LOCAL_FILE_REJECTED", src);
    }
    return new Uint8Array(await response.arrayBuffer());
  },
};

async function measureImage(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image.naturalWidth > 0 && image.naturalHeight > 0
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : undefined;
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function toBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function failure(stage: "input" | "render" | "project", error: unknown): RenderResponse {
  if (error instanceof ProjectFormatError) {
    return { ok: false, stage, code: error.code, message: error.message, ...(error.path ? { path: error.path } : {}) };
  }
  if (error instanceof PngExportError) {
    return { ok: false, stage, code: error.code, message: error.message, recommendation: error.recommendation };
  }
  return { ok: false, stage, code: "UNEXPECTED", message: error instanceof Error ? error.message : String(error) };
}

async function run(request: RenderRequest): Promise<RenderResponse> {
  let source;
  try {
    source = await loadRenderSource(request.kind, request.fileName, reader, measureImage);
  } catch (error) {
    return failure("input", error);
  }
  const { document, blobs, warnings } = source;
  const summary = {
    title: document.metadata.title || "未命名对话",
    messageCount: document.messages.length,
    blockCount: document.messages.reduce((total, message) => total + message.blocks.length, 0),
    assetCount: document.assets.length,
  };
  if (request.mode === "check") return { ok: true, summary, warnings };

  const urls = new Map([...blobs].map(([storageKey, blob]) => [storageKey, URL.createObjectURL(blob)]));
  const resolveAssetSource = (asset: ConversationAsset) => asset.source.kind === "local"
    ? urls.get(asset.source.storageKey)
    : resolveFixtureAsset(asset);

  await hostReady;
  flushSync(() => hostSetter!(() => ({ document, resolveAssetSource })));
  const canvas = canvasRef.current;
  if (!canvas) return failure("render", new Error("画布没有显示出来。"));

  const settings: PngExportSettings = {
    fileName: summary.title,
    preset: request.preset,
    width: request.preset === "portrait" ? 480 : 720,
    scale: request.scale ?? (request.preset === "portrait" ? 3 : 2),
    foldStrategy: request.foldStrategy,
  };
  let singleImageScale: 1 | 2 | undefined;
  let result;
  try {
    result = await runPngExportSession({
      document,
      canvas,
      settings,
      applyPresentation: (presentation) => hostSetter!((previous) => previous && { ...previous, presentation }),
      // The command line keeps the requested scale and splits; it reports the scale that would fit one PNG.
      onMultiPartPlan: async (choice) => {
        singleImageScale = choice.suggestedScale;
        return { kind: "continue" };
      },
    });
  } catch (error) {
    return failure("render", error);
  }

  const parts = await Promise.all(result.parts.map(async (part) => ({
    index: part.index,
    width: part.metrics.pixelWidth,
    height: part.metrics.pixelHeight,
    base64: await toBase64(part.blob),
  })));

  let project: string | undefined;
  const projectWarnings: ProjectWarning[] = [];
  if (request.includeProject) {
    try {
      // Missing assets were already reported as ASSET_UNAVAILABLE; keep them as
      // "missing" in the package, as the web does after the user confirms.
      const exported = await exportProjectPackage({
        document,
        allowMissingAssets: true,
        resolveAssetBlob: async (asset) => {
          if (asset.source.kind === "local") return blobs.get(asset.source.storageKey);
          const url = resolveFixtureAsset(asset);
          return url ? (await fetch(url)).blob() : undefined;
        },
      });
      project = await toBase64(exported.blob);
      projectWarnings.push(...exported.warnings);
    } catch (error) {
      return failure("project", error);
    }
  }

  return {
    ok: true,
    summary,
    warnings: [...warnings, ...projectWarnings],
    parts,
    scale: result.effectiveSettings.scale,
    ...(singleImageScale ? { singleImageScale } : {}),
    diagnostics: result.diagnostics,
    ...(project ? { project } : {}),
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RenderHost />
  </StrictMode>,
);
window.convoscroll = { run };
