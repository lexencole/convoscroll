import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationDocument } from "../data/conversation-types";
import { createEmptyDocument } from "../editor/document-operations";
import { MemoryProjectStore } from "../persistence/project-store";
import { App } from "./App";
import * as imageReader from "../editor/read-image-dimensions";
import * as downloads from "../export/download-png";
import * as recovery from "../data/recovery-json";

const example: ConversationDocument = { ...createEmptyDocument(), metadata: { title: "测试对话" }, messages: [
  { id: "user", role: "user", displayName: "林岸", blocks: [{ id: "question", type: "markdown", source: "为什么要去海边？" }] },
  { id: "assistant", role: "assistant", displayName: "小卷", model: "ChatGPT", blocks: [
    { id: "answer", type: "markdown", source: "## 海与自由\n\n每个人看见的海都不一样。" },
    { id: "call", type: "toolCall", callId: "call-1", toolName: "note", input: {}, status: "success", displayState: "collapsed", exportState: "current" },
    { id: "result", type: "toolResult", callId: "call-1", output: {}, status: "success", displayState: "collapsed", exportState: "current" },
  ] },
] };
const repeated: ConversationDocument = { ...example, messages: [...example.messages,
  { ...example.messages[0], id: "user-2", blocks: [{ id: "question-2", type: "markdown", source: "继续问" }] },
  { ...example.messages[1], id: "assistant-2", blocks: [{ id: "answer-2", type: "markdown", source: "继续答" }] },
  { ...example.messages[0], id: "other-user", displayName: "另一位", blocks: [{ id: "other-question", type: "markdown", source: "另一位用户" }] },
  { ...example.messages[1], id: "other-model", model: "Gemini", blocks: [{ id: "other-answer", type: "markdown", source: "另一个模型" }] },
] };

async function setup(document = example, store = new MemoryProjectStore()) {
  await store.saveDocument(document, "2026-09-20T00:00:00Z");
  const view = render(<App store={store} />);
  await screen.findByTestId("conversation-canvas");
  return { ...view, store };
}
async function finish() {
  await waitFor(() => expect(screen.getByRole("button", { name: "完成" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}
function customModel() {
  fireEvent.click(screen.getByRole("combobox", { name: "常用模型" }));
  fireEvent.click(screen.getByRole("option", { name: "自定义模型…" }));
}
function moreIdentity() { fireEvent.click(screen.getByRole("button", { name: /^更多设置/ })); }
function chooseDate(value: string) {
  fireEvent.click(screen.getByRole("button", { name: "消息日期" }));
  const [year, month, day] = value.split("-").map(Number);
  for (let i = 0; i < 120; i += 1) {
    const current = screen.getByRole("grid").getAttribute("aria-label")!.match(/(\d+)年(\d+)月/)!;
    const delta = (year - Number(current[1])) * 12 + month - Number(current[2]);
    if (!delta) break;
    fireEvent.click(screen.getByRole("button", { name: delta > 0 ? "下个月" : "上个月" }));
  }
  fireEvent.click(screen.getByRole("button", { name: `${year}年${month}月${day}日` }));
}
function chooseTime(hour: string, minute: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "消息时刻" }), { target: { value: hour || minute ? `${hour}:${minute}` : "" } });
}
function expectDate(value: string) { expect(screen.getByRole("button", { name: "消息日期" })).toHaveTextContent(value ? value.replaceAll("-", "/") : "选择日期"); }
function expectTime(hour: string, minute: string) {
  expect(screen.getByRole("textbox", { name: "消息时刻" })).toHaveValue(hour || minute ? `${hour}:${minute}` : "");
}
/** Adds content to the selected message through its own menu. */
function addContent(name: string, index = 0) {
  fireEvent.keyDown(screen.getByRole("button", { name: `编辑消息正文：${index + 1}` }), { key: "Enter" });
  fireEvent.click(screen.getAllByRole("button", { name: "消息操作" })[index]);
  fireEvent.click(screen.getByRole("menuitem", { name }));
}
function documentSettings() {
  fireEvent.click(screen.getByRole("button", { name: "文档" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "标题和说明" }));
}
function blockSettings(name: string, index: number) {
  fireEvent.click(screen.getAllByRole("button", { name: "内容块操作" })[index]);
  fireEvent.click(screen.getByRole("menuitem", { name }));
}
function textBeforeCaret(editor: HTMLElement, selection: Selection): string {
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.setEnd(selection.anchorNode!, selection.anchorOffset);
  return range.toString();
}
afterEach(() => vi.restoreAllMocks());

describe("damaged project recovery download", () => {
  it("serializes only after a click and downloads an intact 8000-level record", async () => {
    const record = { storageVersion: 99, document: JSON.parse("[".repeat(8000) + '"保留"' + "]".repeat(8000)) };
    const store = new MemoryProjectStore();
    Object.defineProperty(store, "loadCurrentProject", { value: async () => record });
    const save = vi.spyOn(store, "saveDocument");
    const replace = vi.spyOn(store, "replaceProject");
    const serialize = vi.spyOn(recovery, "serializeRecoveryRecord");
    const download = vi.spyOn(downloads, "downloadBlob").mockImplementation(() => undefined);
    render(<App store={store} />);
    const button = await screen.findByRole("button", { name: "下载原始记录（含对话）" });
    expect(serialize).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(download).toHaveBeenCalledOnce();
    expect(download.mock.calls[0][1]).toBe("convoscroll-recovery.json");
    const blob = download.mock.calls[0][0];
    let restored = JSON.parse(new TextDecoder().decode(await blob.arrayBuffer())).document;
    for (let depth = 0; depth < 8000; depth++) restored = restored[0];
    expect(restored).toBe("保留");
    expect(save).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  });

  it.each(["cycle", "non-json", "download"])("reports %s recovery failure without changing the record", async (failure) => {
    const cycle: unknown[] = []; cycle.push(cycle);
    const record = { storageVersion: 99, document: failure === "cycle" ? cycle : failure === "non-json" ? new Map([["keep", "data"]]) : { keep: "data" } };
    const store = new MemoryProjectStore();
    Object.defineProperty(store, "loadCurrentProject", { value: async () => record });
    const replace = vi.spyOn(store, "replaceProject");
    const download = vi.spyOn(downloads, "downloadBlob").mockImplementation(() => { throw new Error("blocked"); });
    render(<App store={store} />);
    fireEvent.click(await screen.findByRole("button", { name: "下载原始记录（含对话）" }));
    expect(screen.getByText(/下载失败.*本地记录未改动/)).toHaveAttribute("role", "alert");
    if (failure !== "download") expect(download).not.toHaveBeenCalled();
    expect(await store.loadCurrentProject()).toBe(record);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("single-canvas workbench", () => {
  it.each(["metaKey", "ctrlKey"])("deletes the focused message with %s+Shift+Backspace and restores it with undo", async (modifier) => {
    const { container, store } = await setup();
    const editorButton = screen.getByRole("button", { name: "编辑消息正文：1" });
    fireEvent.keyDown(editorButton, { key: "Enter" });
    const editor = await screen.findByRole("textbox", { name: "直接编辑消息正文：1" });
    fireEvent.keyDown(editor, { key: "Backspace", shiftKey: true, [modifier]: true });
    expect(container.querySelector('[data-message-id="user"]')).toBeNull();
    expect(container.querySelector('.workbench-notice')).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "设置身份：小卷" })).toHaveFocus());
    await waitFor(async () => expect(((await store.loadCurrentProject())!.document as ConversationDocument).messages.map((message) => message.id)).toEqual(["assistant"]));
    fireEvent.keyDown(screen.getByRole("button", { name: "设置身份：小卷" }), { key: "z", [modifier]: true });
    expect(container.querySelector('[data-message-id="user"]')).toHaveTextContent("为什么要去海边？");
    expect(container.querySelectorAll('[data-message-id]')).toHaveLength(2);
  });
  it("targets the open message menu instead of a previously active message", async () => {
    const { container } = await setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "编辑消息正文：2" }), { key: "Enter" });
    await screen.findByRole("textbox", { name: "直接编辑消息正文：2" });
    fireEvent.click(screen.getAllByRole("button", { name: "消息操作" })[0]);
    expect(screen.getByRole("menuitem", { name: "删除消息" })).toHaveAttribute("aria-keyshortcuts", "Meta+Shift+Backspace Control+Shift+Backspace");
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "正文" }), { key: "Backspace", metaKey: true, shiftKey: true });
    expect(container.querySelector('[data-message-id="user"]')).toBeNull();
    expect(container.querySelector('[data-message-id="assistant"]')).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "设置身份：小卷" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("button", { name: "设置身份：小卷" }), { key: "Backspace", metaKey: true, shiftKey: true, repeat: true });
    expect(container.querySelectorAll('[data-message-id]')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("button", { name: "设置身份：小卷" }), { key: "Backspace", metaKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByRole("button", { name: /^用户消息$/ })).toHaveFocus());
    expect(container.querySelectorAll('[data-message-id]')).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(container.querySelectorAll('[data-message-id]')).toHaveLength(1);
  });
  it("does not delete while composing or in title, settings, preview, or ordinary Backspace input", async () => {
    const { container } = await setup();
    const shortcut = { key: "Backspace", metaKey: true, shiftKey: true };
    const count = () => expect(container.querySelectorAll('[data-message-id]')).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole("button", { name: "编辑消息正文：1" }), { key: "Enter" });
    const editor = await screen.findByRole("textbox", { name: "直接编辑消息正文：1" });
    fireEvent.keyDown(editor, { key: "Backspace" }); count();
    fireEvent.keyDown(editor, { ...shortcut, isComposing: true }); count();
    fireEvent.compositionStart(editor);
    fireEvent.keyDown(editor, shortcut); count();
    fireEvent.compositionEnd(editor);
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑标题" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "编辑标题" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "标题" }), shortcut); count();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "标题" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "设置身份：林岸" }));
    fireEvent.keyDown(screen.getByLabelText("显示名称"), shortcut); count();
    await finish();
    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    fireEvent.keyDown(container.querySelector('[data-message-id="user"]')!, shortcut); count();
  });
  it("edits the canvas title with grouped undo and restores the saved title on reload", async () => {
    const { store, unmount } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "编辑标题" }));
    const title = screen.getByRole("textbox", { name: "标题" });
    fireEvent.change(title, { target: { value: "新的" } });
    fireEvent.change(title, { target: { value: "新的标题" } });
    fireEvent.keyDown(title, { key: "z", metaKey: true });
    expect(title).toHaveValue("测试对话");
    fireEvent.keyDown(title, { key: "z", metaKey: true, shiftKey: true });
    expect(title).toHaveValue("新的标题");
    fireEvent.keyDown(title, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑标题" })).toHaveFocus());
    await waitFor(async () => expect(((await store.loadCurrentProject())!.document as ConversationDocument).metadata.title).toBe("新的标题"));
    unmount(); render(<App store={store} />);
    expect(await screen.findByRole("button", { name: "编辑标题" })).toHaveTextContent("新的标题");
  });
  it("holds title composition through blur and publishes the final Chinese text once", async () => {
    const { store } = await setup();
    const save = vi.spyOn(store, "saveDocument");
    fireEvent.click(screen.getByRole("button", { name: "编辑标题" }));
    const title = screen.getByRole("textbox", { name: "标题" });
    fireEvent.compositionStart(title);
    fireEvent.change(title, { target: { value: "zhong" } });
    fireEvent.keyDown(title, { key: "Enter", isComposing: true });
    fireEvent.blur(title);
    expect(title).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 PNG" })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    fireEvent.compositionEnd(title, { target: { value: "中文标题" }, data: "中文标题" });
    expect(screen.getByRole("button", { name: "编辑标题" })).toHaveTextContent("中文标题");
    await waitFor(async () => expect(((await store.loadCurrentProject())!.document as ConversationDocument).metadata.title).toBe("中文标题"));
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("button", { name: "编辑标题" })).toHaveTextContent("测试对话");
  });
  it("opens export settings from the brand menu and restores focus to the brand", async () => {
    await setup();
    const brand = screen.getByRole("button", { name: "文档" });
    fireEvent.click(brand);
    fireEvent.click(screen.getByRole("menuitem", { name: "导出设置" }));
    expect(screen.getByRole("dialog", { name: "导出设置" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "撤销" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    await waitFor(() => expect(brand).toHaveFocus());
    expect(screen.getAllByRole("button", { name: "撤销" })).toHaveLength(1);
  });
  it("limits compact trace actions to editing and preserves disclosures and menus", async () => {
    const { container } = await setup();
    const trace = container.querySelector('[data-workbench-block="call"]') as HTMLElement;
    expect(trace).toHaveClass("workbench-block--trace");
    expect(container.querySelector('[data-workbench-block="result"]')).toHaveClass("workbench-block--trace");
    expect(container.querySelector('[data-workbench-block="answer"]')).not.toHaveClass("workbench-block--trace");
    const toggle = trace.querySelector(".trace-card__toggle")!;
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(trace).getByRole("button", { name: "内容块操作" }));
    expect(screen.getByRole("menuitem", { name: "工具调用设置" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(container.querySelector(".workbench-block--trace")).toBeNull();
    expect(container.querySelectorAll(".trace-card")).toHaveLength(2);
  });
  it("saves the arrow on a trace card to the document and undoes it", async () => {
    const { container, store } = await setup();
    const toggle = container.querySelector('[data-workbench-block="call"] .trace-card__toggle')!;
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(async () => expect(((await store.loadCurrentProject())!.document as ConversationDocument).messages[1].blocks[1]).toMatchObject({ displayState: "expanded" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await waitFor(async () => expect(((await store.loadCurrentProject())!.document as ConversationDocument).messages[1].blocks[1]).toMatchObject({ displayState: "collapsed" }));
  });
  it("leaves expanding and the export fold out of the trace settings", async () => {
    await setup(); blockSettings("工具调用设置", 2);
    expect(screen.queryByText("预览时")).toBeNull();
    expect(screen.queryByText("导出时")).toBeNull();
    // The choices read the same as the badge on the card.
    expect(screen.getByRole("combobox", { name: "状态" })).toHaveTextContent("已完成");
    fireEvent.click(screen.getByRole("combobox", { name: "状态" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["记录", "等待中", "进行中", "已完成", "失败"]);
  });
  it("keeps rare identity fields collapsed and never writes when revealing controls", async () => {
    const { store } = await setup(); const save = vi.spyOn(store, "saveDocument");
    fireEvent.click(screen.getByRole("button", { name: "设置身份：林岸" }));
    expect(screen.queryByRole("combobox", { name: "角色" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "常用模型" })).toBeNull();
    expect(screen.queryByLabelText("消息时间")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "只改这一条" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "同步范围说明" }));
    expect(screen.getByText(/切换范围只影响之后的修改/)).toBeVisible();
    moreIdentity();
    expect(screen.getByRole("combobox", { name: "角色" })).toBeVisible();
    customModel();
    expect(screen.getByLabelText("模型名称")).toHaveValue("");
    moreIdentity(); await finish();
    expect(save).not.toHaveBeenCalled();
  });
  it("opens custom model editing without clearing its preset and allows explicit removal", async () => {
    const { store } = await setup(); const save = vi.spyOn(store, "saveDocument");
    fireEvent.click(screen.getByRole("button", { name: "设置身份：小卷" }));
    expect(screen.queryByLabelText("模型名称")).toBeNull(); customModel();
    const input = screen.getByLabelText("模型名称");
    expect(input).toHaveValue("ChatGPT"); await waitFor(() => expect(input).toHaveFocus());
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "local-model-v2" } });
    await finish();
    fireEvent.click(screen.getByRole("button", { name: "设置身份：小卷" }));
    expect(screen.getByLabelText("模型名称")).toHaveValue("local-model-v2");
    fireEvent.click(screen.getByRole("combobox", { name: "常用模型" }));
    fireEvent.click(screen.getByRole("option", { name: "不标注模型" }));
    expect(screen.queryByLabelText("模型名称")).toBeNull();
    await waitFor(async () => expect(((await store.loadCurrentProject())!.document as ConversationDocument).messages[1].model).toBe(""));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("模型名称")).toHaveValue("local-model-v2");
  });
  it("shows no summary when nothing rare is set", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "设置身份：林岸" }));
    expect(screen.getByRole("button", { name: /^更多设置/ })).toHaveTextContent(/^更多设置$/);
  });
  it("summarizes existing rare values and cannot collapse an invalid or composing field", async () => {
    await setup({ ...example, messages: [{ ...example.messages[0], timestamp: "2026-09-20T12:00:00Z", status: "complete" }] });
    fireEvent.click(screen.getByRole("button", { name: "设置身份：林岸" }));
    expect(screen.getByRole("button", { name: /^更多设置/ })).toHaveTextContent(/^更多设置已完成 · 已设时间$/);
    moreIdentity();
    chooseTime("", "");
    expect(screen.getByRole("button", { name: /^更多设置/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "恢复原值" }));
    const input = screen.getByLabelText("显示名称");
    fireEvent.compositionStart(input);
    expect(screen.getByRole("button", { name: /^更多设置/ })).toBeDisabled();
    fireEvent.compositionEnd(input);
    expect(screen.getByRole("button", { name: /^更多设置/ })).toBeEnabled();
  });
  it("opens identity from its menu without stealing focus and restores the trigger on close", async () => {
    await setup(); const trigger = screen.getAllByRole("button", { name: "消息操作" })[0];
    fireEvent.click(trigger); fireEvent.click(screen.getByRole("menuitem", { name: "编辑身份" }));
    await waitFor(() => expect(screen.getByLabelText("显示名称")).toHaveFocus());
    expect(screen.queryByRole("menu")).toBeNull(); await finish();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("copies, orders and deletes messages from the new menu with one-step undo", async () => {
    const { container } = await setup();
    const names = () => [...container.querySelectorAll('[data-message-id] .message__identity strong')].map((element) => element.textContent);
    fireEvent.click(screen.getAllByRole("button", { name: "消息操作" })[0]);
    expect(screen.getByRole("menuitem", { name: "上移消息" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "复制消息" }));
    expect(names()).toEqual(["林岸", "林岸", "小卷"]);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    fireEvent.click(screen.getAllByRole("button", { name: "消息操作" })[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "下移消息" }));
    expect(names()).toEqual(["小卷", "林岸"]);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    fireEvent.click(screen.getAllByRole("button", { name: "消息操作" })[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除消息" }));
    expect(names()).toEqual(["小卷"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "设置身份：小卷" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(names()).toEqual(["林岸", "小卷"]);
    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(container.querySelector('.workbench-message-heading')).toBeNull();
    expect(screen.queryByRole("button", { name: "消息操作" })).toBeNull();
    expect(names()).toEqual(["林岸", "小卷"]);
  });
  it("bounds panel undo to the opening document and supports keyboard undo and redo", async () => {
    const { container } = await setup(repeated);
    fireEvent.keyDown(screen.getAllByRole("button", { name: "拖动消息" })[0], { key: "ArrowDown" });
    const order = () => Array.from(container.querySelectorAll("[data-message-id]")).map((element) => element.getAttribute("data-message-id"));
    const openingOrder = order();
    fireEvent.click(screen.getAllByRole("button", { name: "设置身份：林岸" })[0]);
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
    const name = screen.getByLabelText("显示名称");
    fireEvent.change(name, { target: { value: "新名字" } });
    fireEvent.keyDown(name, { key: "z", metaKey: true });
    expect(name).toHaveValue("林岸");
    fireEvent.keyDown(name, { key: "z", metaKey: true });
    expect(order()).toEqual(openingOrder);
    fireEvent.keyDown(name, { key: "z", metaKey: true, shiftKey: true });
    expect(name).toHaveValue("新名字");
  });
  it("uses the new scope only for later edits and keeps undo groups separate", async () => {
    await setup(repeated);
    fireEvent.click(screen.getAllByRole("button", { name: "设置身份：林岸" })[0]);
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "共同名称" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "只改这一条" }));
    expect(screen.getByTestId("conversation-canvas").querySelectorAll('[aria-label="设置身份：共同名称"]')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "单条名称" } });
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("显示名称")).toHaveValue("共同名称");
    expect(screen.getByTestId("conversation-canvas").querySelectorAll('[aria-label="设置身份：共同名称"]')).toHaveLength(2);
  });
  it("keeps identity controls locked during a shared avatar write and cleans up on unmount", async () => {
    const store = new MemoryProjectStore(); const original = store.putAsset.bind(store);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(store, "putAsset").mockImplementation(async (record) => { await pending; await original(record); });
    const remove = vi.spyOn(store, "deleteAsset");
    vi.spyOn(imageReader, "readImageDimensions").mockResolvedValue({ width: 32, height: 32 });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pending-avatar");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { unmount } = await setup(repeated, store);
    fireEvent.click(screen.getAllByRole("button", { name: "设置身份：林岸" })[0]);
    fireEvent.change(screen.getByLabelText("选择头像"), { target: { files: [new File(["avatar"], "pending.png", { type: "image/png" })] } });
    await waitFor(() => expect(store.putAsset).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("显示名称")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "只改这一条" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "关闭设置" })).toBeDisabled();
    unmount(); await act(async () => { release(); await pending; });
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect((await store.loadCurrentProject())!.document).toEqual(repeated);
  });
  it("updates all matching messages immediately and keeps the target group stable while typing", async () => {
    const { store, unmount } = await setup(repeated);
    fireEvent.click(screen.getAllByRole("button", { name: "设置身份：小卷" })[0]);
    expect(screen.getByText("将同步 2 条同身份消息")).toBeVisible();
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "新" } });
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "新名字" } });
    expect(screen.getByTestId("conversation-canvas").querySelectorAll('[aria-label="设置身份：新名字"]')).toHaveLength(2);
    customModel();
    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "Claude" } });
    await waitFor(async () => {
      const document = (await store.loadCurrentProject())!.document as ConversationDocument;
      expect(document.messages.filter((message) => ["assistant", "assistant-2"].includes(message.id)).every((message) => message.displayName === "新名字" && message.model === "Claude")).toBe(true);
      expect(document.messages[5]).toEqual(repeated.messages[5]);
      expect(document.messages[1].blocks).toEqual(repeated.messages[1].blocks);
    });
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("模型名称")).toHaveValue("ChatGPT");
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("显示名称")).toHaveValue("小卷");
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.getByLabelText("显示名称")).toHaveValue("新名字");
    await waitFor(async () => expect(((await store.loadCurrentProject())!.document as ConversationDocument).messages[3].displayName).toBe("新名字"));
    await finish(); unmount(); render(<App store={store} />);
    expect(await screen.findAllByRole("button", { name: "设置身份：新名字" })).toHaveLength(2);
  });
  it("keeps a single-message identity override separate when reopening either group", async () => {
    const { store } = await setup(repeated);
    fireEvent.click(screen.getAllByRole("button", { name: "设置身份：林岸" })[0]);
    fireEvent.click(screen.getByRole("checkbox", { name: "只改这一条" }));
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "这一条" } });
    await finish();
    fireEvent.click(screen.getByRole("button", { name: "设置身份：林岸" }));
    expect(screen.getByText("将同步 1 条同身份消息")).toBeVisible();
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "其余消息" } });
    await finish();
    expect(screen.getByRole("button", { name: "设置身份：这一条" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置身份：另一位" })).toBeInTheDocument();
    await waitFor(async () => expect(((await store.loadCurrentProject())!.document as ConversationDocument).messages[2].displayName).toBe("其余消息"));
  });
  it("changes default model names with the preset while retaining custom names", async () => {
    const document = { ...repeated, messages: repeated.messages.map((message) => message.model === "ChatGPT" ? { ...message, displayName: "ChatGPT" } : message) };
    await setup(document);
    fireEvent.click(screen.getAllByRole("button", { name: "设置身份：ChatGPT" })[0]);
    fireEvent.click(screen.getByRole("combobox", { name: "常用模型" }));
    fireEvent.click(screen.getByRole("option", { name: "Claude" }));
    expect(screen.getByLabelText("显示名称")).toHaveValue("Claude");
    expect(screen.getByRole("combobox", { name: "常用模型" })).toHaveTextContent("Claude");
    await finish();
    expect(screen.getAllByRole("button", { name: "设置身份：Claude" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "设置身份：小卷" })).toBeInTheDocument();
  });
  it("does not persist IME intermediate identity text and preserves one undo group", async () => {
    const { store } = await setup(repeated);
    fireEvent.click(screen.getAllByRole("button", { name: "设置身份：林岸" })[0]);
    const name = screen.getByLabelText("显示名称");
    fireEvent.compositionStart(name);
    fireEvent.change(name, { target: { value: "lin" } });
    expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "只改这一条" })).toBeDisabled();
    expect((await store.loadCurrentProject())!.document).toEqual(repeated);
    fireEvent.change(name, { target: { value: "林间" } });
    fireEvent.compositionEnd(name);
    expect(name).toHaveValue("林间"); expect(name).toBeInTheDocument();
    expect(screen.getByTestId("conversation-canvas").querySelectorAll('[aria-label="设置身份：林间"]')).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(name).toHaveValue("林岸");
  });
  it("keeps invalid local metadata as a draft and never spreads status or time to other messages", async () => {
    const { store } = await setup(repeated);
    fireEvent.click(screen.getAllByRole("button", { name: "设置身份：林岸" })[0]);
    moreIdentity();
    chooseDate("2026-09-20");
    expectDate("2026-09-20");
    expect(screen.getByLabelText("显示名称")).toBeDisabled();
    expect((await store.loadCurrentProject())!.document).toEqual(repeated);
    chooseTime("12", "00");
    fireEvent.click(screen.getByRole("combobox", { name: "消息状态" }));
    fireEvent.click(screen.getByRole("option", { name: "已完成" }));
    await waitFor(async () => {
      const document = (await store.loadCurrentProject())!.document as ConversationDocument;
      expect(document.messages[0].status).toBe("complete");
      expect(Date.parse(document.messages[0].timestamp!)).toBe(new Date(2026, 8, 20, 12).getTime());
      expect(document.messages[2].timestamp).toBeUndefined(); expect(document.messages[2].status).toBeUndefined();
    });
    await finish();
  });
  it("keeps an existing timestamp unchanged on open, and preserves precision through edits, clear and undo", async () => {
    const timestamp = "2026-09-20T12:34:56.123456+05:45";
    const original = { ...repeated, messages: repeated.messages.map((message, i) => i ? message : { ...message, timestamp }) };
    const { store } = await setup(original);
    fireEvent.click(screen.getAllByRole("button", { name: "设置身份：林岸" })[0]); moreIdentity();
    expectDate("2026-09-20");
    expectTime("12", "34");
    expect((await store.loadCurrentProject())!.document).toEqual(original);
    chooseDate("2026-09-21");
    chooseTime("08", "15");
    const edited = "2026-09-21T08:15:56.123456+05:45";
    await waitFor(async () => expect(((await store.loadCurrentProject())!.document as ConversationDocument).messages[0].timestamp).toBe(edited));
    fireEvent.click(screen.getByRole("button", { name: "清除时间" }));
    expectDate("");
    expectTime("", "");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "撤销" }));
    expectTime("08", "15");
    await waitFor(async () => {
      const document = (await store.loadCurrentProject())!.document as ConversationDocument;
      expect(document.messages[0].timestamp).toBe(edited);
      expect(document.messages[2].timestamp).toBeUndefined();
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "撤销" }));
    expectDate("2026-09-20");
    expectTime("12", "34");
    await waitFor(async () => expect(((await store.loadCurrentProject())!.document as ConversationDocument).messages[0].timestamp).toBe(timestamp));
    await finish();
  });
  it("keeps incomplete or invalid typed times as drafts and restores the saved time", async () => {
    const original = { ...example, messages: [{ ...example.messages[0], timestamp: "2026-09-20T12:34:00Z" }] };
    const { store } = await setup(original);
    fireEvent.click(screen.getByRole("button", { name: "设置身份：林岸" })); moreIdentity();
    const time = screen.getByRole("textbox", { name: "消息时刻" });
    for (const value of ["1", "12:", "25:30"]) {
      fireEvent.change(time, { target: { value } });
      expect(time).toHaveValue(value);
      expect(time).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toHaveTextContent("请输入 HH:mm");
      expect((await store.loadCurrentProject())!.document).toEqual(original);
    }
    expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "关闭设置" })).toBeDisabled();
    expect((await store.loadCurrentProject())!.document).toEqual(original);
    fireEvent.click(screen.getByRole("button", { name: "恢复原值" }));
    expectDate("2026-09-20"); expectTime("12", "34");
    await finish();
  });
  it("waits until time composition finishes before saving a valid-looking draft", async () => {
    const original = { ...example, messages: [{ ...example.messages[0], timestamp: "2026-09-20T12:34:00Z" }] };
    const { store } = await setup(original);
    fireEvent.click(screen.getByRole("button", { name: "设置身份：林岸" })); moreIdentity();
    const time = screen.getByRole("textbox", { name: "消息时刻" });
    fireEvent.compositionStart(time);
    fireEvent.change(time, { target: { value: "14:30" } });
    expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();
    expect((await store.loadCurrentProject())!.document).toEqual(original);
    fireEvent.compositionEnd(time);
    await waitFor(async () => expect(((await store.loadCurrentProject())!.document as ConversationDocument).messages[0].timestamp).toBe("2026-09-20T14:30:00Z"));
    await finish();
  });
  it("lets the page scroll during settings while restoring background interaction on close", async () => {
    const { container } = await setup();
    blockSettings("工具调用设置", 2);
    expect(document.documentElement.style.overflow).not.toBe("hidden");
    expect(container).toHaveAttribute("inert");
    expect(screen.getByLabelText("用时（毫秒）")).toBeEnabled();
    await finish();
    expect(container).not.toHaveAttribute("inert");
  });
  it("retries a failed shared avatar without partially changing identities and supports undo", async () => {
    vi.spyOn(imageReader, "readImageDimensions").mockResolvedValue({ width: 32, height: 32 });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shared-avatar");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { store } = await setup(repeated);
    const put = vi.spyOn(store, "putAsset").mockRejectedValueOnce(new Error("头像存储失败"));
    fireEvent.click(screen.getAllByRole("button", { name: "设置身份：林岸" })[0]);
    fireEvent.change(screen.getByLabelText("选择头像"), { target: { files: [new File(["avatar"], "shared.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("头像存储失败");
    expect((await store.loadCurrentProject())!.document).toEqual(repeated);
    fireEvent.click(screen.getByRole("button", { name: "再试一次" }));
    await waitFor(async () => {
      const document = (await store.loadCurrentProject())!.document as ConversationDocument;
      expect(document.assets).toHaveLength(1);
      expect(document.messages[0].avatarAssetId).toBe(document.assets[0].id);
      expect(document.messages[2].avatarAssetId).toBe(document.assets[0].id);
      expect(document.messages[4].avatarAssetId).toBeUndefined();
    });
    expect(put).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(async () => expect((await store.loadCurrentProject())!.document).toEqual(repeated));
  });
  it("stores photos without their GPS data", async () => {
    vi.spyOn(imageReader, "readImageDimensions").mockResolvedValue({ width: 32, height: 32 });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:located-avatar");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { store } = await setup(repeated);
    const put = vi.spyOn(store, "putAsset");
    const xmp = new TextEncoder().encode(`http://ns.adobe.com/xap/1.0/\0<rdf:Description exif:GPSLatitude="63,31.88N"/>`);
    const length = xmp.length + 2;
    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...xmp, 0xff, 0xd9])], "located.jpg", { type: "image/jpeg" });
    fireEvent.click(screen.getAllByRole("button", { name: "设置身份：林岸" })[0]);
    fireEvent.change(screen.getByLabelText("选择头像"), { target: { files: [photo] } });
    await waitFor(() => expect(put).toHaveBeenCalledOnce());
    const stored = put.mock.calls[0][0].blob;
    expect(stored.size).toBe(photo.size);
    expect(new TextDecoder().decode(await stored.arrayBuffer())).not.toContain("GPS");
    await finish();
  });
  it("opens and closes unchanged identity settings without a write or departure warning", async () => {
    const { store } = await setup(); const save = vi.spyOn(store, "saveDocument");
    fireEvent.click(screen.getByRole("button", { name: "设置身份：林岸" }));
    const departure = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(departure);
    expect(departure.defaultPrevented).toBe(false);
    await finish();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
  });
  it("closes unchanged settings without creating an undo entry", async () => {
    await setup(); documentSettings();
    const departure = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(departure);
    expect(departure.defaultPrevented).toBe(false);
    await finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled());
  });
  it("shows the image language selector without writes and keeps the settings focus trap", async () => {
    const { store } = await setup(); const save = vi.spyOn(store, "saveDocument");
    documentSettings();
    expect(screen.queryByText("尚未应用")).toBeNull();
    expect(screen.getByRole("combobox", { name: "成图语言" })).toBeVisible();
    const close = screen.getByRole("button", { name: "关闭设置" });
    act(() => close.focus()); fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "完成" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "完成" }), { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.click(close); expect(save).not.toHaveBeenCalled();
  });
  it("does not attach a file selected for a document replaced while the picker was open", async () => {
    const { store } = await setup(); const put = vi.spyOn(store, "putAsset");
    addContent("文件");
    fireEvent.click(screen.getByRole("button", { name: "文档" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "新建空白" }));
    fireEvent.change(screen.getByLabelText("添加本地附件"), { target: { files: [new File(["笔记"], "notes.md")] } });
    expect(screen.getByText("选择文件期间，当前内容已更新。文件未添加，请重新选择添加位置和文件")).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });
  it("adds, replaces, removes and undoes a local avatar without destroying old blobs", async () => {
    vi.spyOn(imageReader, "readImageDimensions").mockResolvedValue({ width: 32, height: 32 });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:avatar");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { store } = await setup();
    async function avatar(name: string) {
      fireEvent.click(screen.getByRole("button", { name: "设置身份：小卷" }));
      fireEvent.change(screen.getByLabelText("选择头像"), { target: { files: [new File([name], name, { type: "image/png" })] } });
      await waitFor(async () => expect(JSON.stringify((await store.loadCurrentProject())?.document)).toContain(name)); await finish();
    }
    await avatar("avatar-1.png");
    const first = (await store.loadCurrentProject())?.document as ConversationDocument;
    await avatar("avatar-2.png");
    const second = (await store.loadCurrentProject())?.document as ConversationDocument;
    expect(first.messages[1].avatarAssetId).not.toBe(second.messages[1].avatarAssetId);
    expect(await store.getAsset(first.assets[0].source.kind === "local" ? first.assets[0].source.storageKey : "")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "设置身份：小卷" }));
    fireEvent.click(screen.getByRole("button", { name: "移除头像" })); await finish();
    await waitFor(async () => expect(((await store.loadCurrentProject())?.document as ConversationDocument).messages[1].avatarAssetId).toBeUndefined());
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(async () => expect(((await store.loadCurrentProject())?.document as ConversationDocument).messages[1].avatarAssetId).toBe(second.messages[1].avatarAssetId));
  });
  it("keeps a failed avatar available for retry and never writes the attachment", async () => {
    vi.spyOn(imageReader, "readImageDimensions").mockRejectedValue(new Error("图片无法解码"));
    const { store } = await setup(); const put = vi.spyOn(store, "putAsset");
    fireEvent.click(screen.getByRole("button", { name: "设置身份：小卷" }));
    fireEvent.change(screen.getByLabelText("选择头像"), { target: { files: [new File(["invalid"], "bad.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("图片无法解码");
    expect(screen.getByText("头像更换失败，已保留原头像")).toBeInTheDocument();
    expect((await store.loadCurrentProject())?.document).toEqual(example); expect(put).not.toHaveBeenCalled();
  });
  it("rejects the resource budget before decoding an oversized image", async () => {
    const decode = vi.spyOn(imageReader, "readImageDimensions");
    await setup(); fireEvent.click(screen.getByRole("button", { name: "设置身份：小卷" }));
    const file = new File(["small stub"], "large.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 33 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText("选择头像"), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("太大了");
    expect(decode).not.toHaveBeenCalled();
  });
  it("locks controls during storage and cleans up an uncommitted blob after unmount", async () => {
    const store = new MemoryProjectStore(); const original = store.putAsset.bind(store);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(store, "putAsset").mockImplementation(async (record) => { await pending; await original(record); });
    const remove = vi.spyOn(store, "deleteAsset");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pending");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { unmount } = await setup(example, store);
    addContent("文件");
    fireEvent.change(screen.getByLabelText("添加本地附件"), { target: { files: [new File(["笔记"], "notes.md")] } });
    expect(screen.getByRole("button", { name: "预览" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导出 PNG" })).toBeDisabled();
    unmount(); await act(async () => { release(); await pending; });
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect((await store.loadCurrentProject())?.document).toEqual(example);
  });
  it("loads existing content without writes and mounts only the active inline editor", async () => {
    const { store, container } = await setup(); const save = vi.spyOn(store, "saveDocument");
    expect(screen.queryByText("对话排版 · 长图导出")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑标题" })).toBeInTheDocument();
    expect(screen.queryByText("AI 对话长图编辑器")).not.toBeInTheDocument();
    expect(container.querySelector(".editor-panel")).toBeNull();
    expect(container.querySelectorAll("[contenteditable=true]")).toHaveLength(0);
    expect(screen.getByTestId("conversation-canvas")).toHaveAttribute("data-canvas-editing", "true");
    fireEvent.keyDown(screen.getByRole("button", { name: "编辑消息正文：1" }), { key: "Enter" });
    await screen.findByRole("textbox", { name: "直接编辑消息正文：1" });
    fireEvent.keyDown(screen.getByRole("button", { name: "编辑消息正文：2" }), { key: "Enter" });
    await screen.findByRole("textbox", { name: "直接编辑消息正文：2" });
    expect(container.querySelectorAll("[contenteditable=true]")).toHaveLength(1);
    // The formatting menu retains the current block's actions without a second toolbar row.
    fireEvent.click(screen.getByRole("button", { name: "更多编辑操作" }));
    expect(screen.getByRole("menuitem", { name: "Markdown 源码" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(container.querySelectorAll("[data-workbench-block], [contenteditable]")).toHaveLength(0);
    expect(screen.getByTestId("conversation-canvas")).not.toHaveAttribute("data-canvas-editing");
    expect(save).not.toHaveBeenCalled();
  });
  it("updates identity immediately, persists without applying and undoes one field at a time", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "设置身份：小卷" }));
    const dialog = screen.getByRole("dialog", { name: "名字与模型" });
    fireEvent.change(within(dialog).getByLabelText("显示名称"), { target: { value: "海边笔记" } });
    customModel();
    fireEvent.change(within(dialog).getByLabelText("模型名称"), { target: { value: "Claude" } });
    expect(screen.queryByRole("button", { name: "保存设置" })).not.toBeInTheDocument();
    expect(screen.getByTestId("conversation-canvas")).toHaveTextContent("海边笔记");
    await waitFor(async () => expect(JSON.stringify((await store.loadCurrentProject())?.document)).toContain("海边笔记"));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("模型名称")).toHaveValue("ChatGPT");
    expect(screen.getByLabelText("显示名称")).toHaveValue("海边笔记");
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("显示名称")).toHaveValue("小卷");
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    await finish();
    expect(screen.getByRole("button", { name: "设置身份：海边笔记" })).toBeInTheDocument();
  });
  it("saves title changes at once and undoes them inside the panel", async () => {
    const { store } = await setup(); documentSettings();
    const dialog = screen.getByRole("dialog", { name: "标题和说明" });
    expect(within(dialog).getByRole("button", { name: "撤销" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "海边" } });
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "海边笔记" } });
    // The page behind the open panel is hidden from assistive tech, so look past that.
    expect(screen.getByRole("heading", { name: "海边笔记", hidden: true })).toBeInTheDocument();
    await waitFor(async () => expect(((await store.loadCurrentProject())?.document as ConversationDocument).metadata.title).toBe("海边笔记"));
    expect(within(dialog).getByText("自动保存")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("标题")).toHaveValue("测试对话");
    expect(screen.getByRole("heading", { name: "测试对话", hidden: true })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "撤销" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "重做" }));
    expect(screen.getByLabelText("标题")).toHaveValue("海边笔记");
    fireEvent.click(screen.getByRole("button", { name: "关闭设置" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "海边笔记" })).toBeInTheDocument();
  });
  it("waits for an input method to finish before saving a block setting", async () => {
    const { store } = await setup(); const save = vi.spyOn(store, "saveDocument"); blockSettings("工具调用设置", 2);
    const summary = screen.getByLabelText("摘要");
    fireEvent.compositionStart(summary);
    fireEvent.change(summary, { target: { value: "hai" } });
    expect(summary).toHaveValue("hai");
    expect(screen.getByTestId("conversation-canvas")).not.toHaveTextContent("hai");
    expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();
    const departure = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(departure);
    expect(departure.defaultPrevented).toBe(true);
    fireEvent.change(summary, { target: { value: "海" } });
    fireEvent.compositionEnd(summary);
    expect(screen.getByTestId("conversation-canvas")).toHaveTextContent("海");
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(JSON.stringify(save.mock.lastCall?.[0])).not.toContain("hai");
    await finish();
  });
  it.each([["notes.md", "new.md"], ["笔记", "笔记"]])("replaces a file and its default name, preserving custom label %s and failed attempts", async (label, expectedLabel) => {
    const withFile: ConversationDocument = { ...example,
      assets: [{ id: "notes", kind: "file", fileName: "notes.md", mimeType: "text/markdown", byteSize: 6, source: { kind: "local", storageKey: "local:notes" } }],
      messages: [{ ...example.messages[0], blocks: [...example.messages[0].blocks, { id: "attached", type: "file", assetId: "notes", label }] }, example.messages[1]] };
    const store = new MemoryProjectStore();
    await store.putAsset({ storageKey: "local:notes", blob: new Blob(["原文"], { type: "text/markdown" }), fileName: "notes.md", mimeType: "text/markdown", byteSize: 6, savedAt: "2026-09-20T00:00:00Z" });
    await setup(withFile, store);
    const put = vi.spyOn(store, "putAsset").mockRejectedValueOnce(new Error("存储失败"));
    blockSettings("文件设置", 1);
    fireEvent.change(screen.getByLabelText("替换文件"), { target: { files: [new File(["新笔记"], "new.md", { type: "text/markdown" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("存储失败");
    expect(screen.getByText("没换成 new.md，还是原来的文件。")).toBeInTheDocument();
    expect(screen.getByLabelText("显示名称")).toHaveValue(label);
    expect((await store.loadCurrentProject())!.document).toEqual(withFile);
    fireEvent.click(screen.getByRole("button", { name: "再试一次" }));
    expect(await screen.findByText(/^new\.md · text\/markdown/)).toBeInTheDocument();
    expect(screen.getByLabelText("显示名称")).toHaveValue(expectedLabel);
    await waitFor(async () => {
      const saved = (await store.loadCurrentProject())!.document as ConversationDocument;
      expect(saved.assets.map((asset) => asset.fileName)).toEqual(["new.md"]);
      expect(saved.messages[0].blocks.at(-1)).toMatchObject({ label: expectedLabel, assetId: saved.assets[0].id });
    });
    expect(put).toHaveBeenCalledTimes(2);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "撤销" }));
    expect(screen.getByText(/^notes\.md · text\/markdown/)).toBeInTheDocument();
    expect(screen.getByLabelText("显示名称")).toHaveValue(label);
    await waitFor(async () => expect((await store.loadCurrentProject())!.document).toEqual(withFile));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "重做" }));
    expect(screen.getByLabelText("显示名称")).toHaveValue(expectedLabel);
    expect(screen.getByText(/^new\.md · text\/markdown/)).toBeInTheDocument();
    await finish();
    expect(screen.getByRole("article", { name: `文件：${expectedLabel}` })).toBeInTheDocument();
  });
  it("rejects invalid JSON, then updates a tool and linked results atomically", async () => {
    const { store } = await setup(); blockSettings("工具调用设置", 2);
    fireEvent.change(screen.getByLabelText("参数（JSON）"), { target: { value: "{" } });
    expect(await screen.findByText("请改正或恢复原值")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();
    expect((await store.loadCurrentProject())?.document).toEqual(example);
    fireEvent.change(screen.getByLabelText("参数（JSON）"), { target: { value: '{"海":true}' } });
    fireEvent.change(screen.getByLabelText("调用 ID"), { target: { value: "renamed-call" } });
    await finish();
    await waitFor(async () => {
      const document = (await store.loadCurrentProject())?.document as ConversationDocument;
      expect(document.messages[1].blocks[1]).toMatchObject({ callId: "renamed-call", input: { 海: true } });
      expect(document.messages[1].blocks[2]).toMatchObject({ callId: "renamed-call" });
    });
  });
  it("toggles a task without opening the editor, preserves exact source, and supports undo", async () => {
    const source = "+ [ ] 需要完成\n  * [X] 子任务\n\n<!-- keep -->";
    const doc = { ...example, messages: [{ ...example.messages[0], blocks: [{ id: "tasks", type: "markdown" as const, source }] }] };
    const { store } = await setup(doc);
    const checkbox = screen.getByRole("checkbox", { name: "完成任务 1" });
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.queryByRole("textbox", { name: /直接编辑消息正文/ })).not.toBeInTheDocument();
    await waitFor(async () => expect(((await store.loadCurrentProject())?.document as ConversationDocument).messages[0].blocks[0]).toMatchObject({ source: source.replace("+ [ ]", "+ [x]") }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(checkbox).not.toBeChecked();
    await waitFor(async () => expect(((await store.loadCurrentProject())?.document as ConversationDocument).messages[0].blocks[0]).toMatchObject({ source }));
  });
  it("keeps rapid task toggles in separate undo steps inside the direct editor", async () => {
    const source = "- [ ] 第一项\n- [ ] 第二项\n";
    const doc = { ...example, messages: [{ ...example.messages[0], blocks: [{ id: "tasks", type: "markdown" as const, source }] }] };
    const { store } = await setup(doc);
    fireEvent.keyDown(screen.getByRole("button", { name: "编辑消息正文：1" }), { key: "Enter" });
    const first = await screen.findByRole("checkbox", { name: "完成任务：第一项" });
    const second = screen.getByRole("checkbox", { name: "完成任务：第二项" });
    fireEvent.click(first); fireEvent.click(second);
    expect(first).toBeChecked(); expect(second).toBeChecked();
    fireEvent.keyDown(second, { key: "z", metaKey: true });
    expect(first).toBeChecked(); expect(second).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(first).not.toBeChecked(); expect(second).not.toBeChecked();
    fireEvent.keyDown(first, { key: "y", ctrlKey: true });
    expect(first).toBeChecked(); expect(second).not.toBeChecked();
    await waitFor(async () => expect(((await store.loadCurrentProject())?.document as ConversationDocument).messages[0].blocks[0]).toMatchObject({ source: "- [x] 第一项\n- [ ] 第二项\n" }));
  });
  it("keeps unsupported Markdown editable through its exact source", async () => {
    const source = "- [x] 不应丢失\n\n<!-- keep -->";
    const doc = { ...example, messages: [{ ...example.messages[0], blocks: [{ id: "raw", type: "markdown" as const, source }] }] };
    const { store } = await setup(doc);
    fireEvent.click(screen.getByRole("button", { name: "编辑消息正文：1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("HTML");
    blockSettings("Markdown 源码", 0);
    const textbox = screen.getByRole("textbox", { name: /Markdown/ });
    expect(textbox).toHaveValue(source);
    fireEvent.change(textbox, { target: { value: source + "\n追加文字" } });
    await finish();
    await waitFor(async () => expect(JSON.stringify((await store.loadCurrentProject())?.document)).toContain("追加文字"));
  });
  it("supports keyboard ordering and removes associated tool results with undo", async () => {
    const { container } = await setup();
    fireEvent.keyDown(screen.getAllByRole("button", { name: "拖动消息" })[0], { key: "ArrowDown" });
    expect(container.querySelector("[data-message-id]")).toHaveAttribute("data-message-id", "assistant");
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(container.querySelector("[data-message-id]")).toHaveAttribute("data-message-id", "user");
    const block = container.querySelector('[data-workbench-block="call"]')!;
    fireEvent.click(within(block as HTMLElement).getByRole("button", { name: "内容块操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除内容块" }));
    expect(container.querySelector('[data-workbench-block="result"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(container.querySelector('[data-workbench-block="result"]')).not.toBeNull();
  });
  it("moves a tool call to another message, keeps its result, and restores both owners with undo/redo", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const { container, store } = await setup();
    const call = () => container.querySelector<HTMLElement>('[data-workbench-block="call"]')!;
    fireEvent.click(within(call()).getByRole("button", { name: "内容块操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "移动到…" }));
    const dialog = screen.getByRole("dialog", { name: "移动到另一条消息" });
    fireEvent.click(within(dialog).getByRole("button", { name: /消息 1，林岸/ }));
    expect(call()).toHaveAttribute("data-owner-message", "user");
    expect(container.querySelector('[data-workbench-block="result"]')).toHaveAttribute("data-owner-message", "assistant");
    await waitFor(() => expect(within(call()).getByRole("button", { name: "内容块操作" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(call()).toHaveAttribute("data-owner-message", "assistant");
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(call()).toHaveAttribute("data-owner-message", "user");
    await waitFor(async () => expect(((await store.loadCurrentProject())!.document as ConversationDocument).messages[0].blocks.at(-1)?.id).toBe("call"));
  });
  it("copies into an empty message and cancels the destination dialog without changing data", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const doc = { ...example, messages: [...example.messages, { id: "empty", role: "assistant" as const, displayName: "空目标", blocks: [] }] };
    const { container, store } = await setup(doc);
    const result = container.querySelector<HTMLElement>('[data-workbench-block="result"]')!;
    const trigger = within(result).getByRole("button", { name: "内容块操作" });
    fireEvent.click(trigger); fireEvent.click(screen.getByRole("menuitem", { name: "复制到…" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(container.querySelector('[data-message-id="empty"] [data-workbench-block]')).toBeNull();
    fireEvent.click(trigger); fireEvent.click(screen.getByRole("menuitem", { name: "复制到…" }));
    fireEvent.click(screen.getByRole("button", { name: /消息 3，空目标，空消息/ }));
    expect(result).toBeInTheDocument();
    await waitFor(async () => {
      const saved = (await store.loadCurrentProject())!.document as ConversationDocument;
      expect(saved.messages[2].blocks[0]).toMatchObject({ type: "toolResult", callId: "call-1" });
      expect(saved.messages[2].blocks[0].id).not.toBe("result");
    });
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(container.querySelector('[data-message-id="empty"] [data-workbench-block]')).toBeNull();
  });
  it("keeps IME input mounted and locks structure/export until composition ends", async () => {
    await setup(); fireEvent.keyDown(screen.getByRole("button", { name: "编辑消息正文：1" }), { key: "Enter" });
    const editor = await screen.findByRole("textbox", { name: "直接编辑消息正文：1" });
    fireEvent.compositionStart(editor);
    expect(screen.getByRole("button", { name: "预览" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导出 PNG" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "编辑消息正文：2" }));
    expect(editor).toBeInTheDocument();
    fireEvent.compositionEnd(editor);
    await waitFor(() => expect(screen.getByRole("button", { name: "预览" })).toBeEnabled());
  });
  it("rejects incomplete timestamp and invalid duration without closing the settings", async () => {
    await setup(); fireEvent.click(screen.getByRole("button", { name: "设置身份：林岸" }));
    moreIdentity();
    chooseDate("2026-09-20");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "恢复原值" })); await finish();
    blockSettings("工具调用设置", 2);
    fireEvent.change(screen.getByLabelText("用时（毫秒）"), { target: { value: "-1" } });
    expect(await screen.findByText("请改正或恢复原值")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "关闭设置" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "恢复原值" }));
    expect(screen.getByLabelText("用时（毫秒）")).toHaveValue("");
    await finish();
  });
  it("retains the original document when attachment storage fails", async () => {
    const store = new MemoryProjectStore(); const put = vi.spyOn(store, "putAsset").mockRejectedValue(new Error("存储失败"));
    await setup(example, store);
    addContent("文件");
    fireEvent.change(screen.getByLabelText("添加本地附件"), { target: { files: [new File(["笔记"], "notes.md", { type: "text/markdown" })] } });
    await screen.findByText("存储失败");
    expect(put).toHaveBeenCalledOnce();
    expect((await store.loadCurrentProject())?.document).toEqual(example);
    expect(screen.getByRole("button", { name: "预览" })).toBeEnabled();
  });
  it("stores a file before its reference, then supports undo and refresh", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-file");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { store, unmount } = await setup();
    addContent("文件");
    fireEvent.change(screen.getByLabelText("添加本地附件"), { target: { files: [new File(["笔记"], "notes.md", { type: "text/markdown" })] } });
    await waitFor(async () => expect(((await store.loadCurrentProject())?.document as ConversationDocument).assets).toHaveLength(1));
    expect(document.querySelector('.workbench-notice')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(async () => expect(((await store.loadCurrentProject())?.document as ConversationDocument).assets).toHaveLength(0));
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    await waitFor(async () => expect(((await store.loadCurrentProject())?.document as ConversationDocument).assets).toHaveLength(1));
    unmount(); render(<App store={store} />);
    await screen.findByTestId("conversation-canvas");
    blockSettings("文件设置", 1);
    expect(screen.getByRole("dialog", { name: "文件设置" })).toBeInTheDocument();
  });
  it("creates independent user and assistant messages from an empty document", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    const { container } = await setup(createEmptyDocument());
    const add = screen.getByRole("group", { name: "添加消息" });
    const user = within(add).getByRole("button", { name: "用户消息" });
    expect(user.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    fireEvent.click(user);
    await screen.findByRole("textbox", { name: "直接编辑消息正文：1" });
    const reply = within(add).getByRole("button", { name: "AI 回复" });
    fireEvent.click(reply);
    await screen.findByRole("textbox", { name: "直接编辑消息正文：2" });
    fireEvent.click(within(add).getByRole("button", { name: "添加其他角色消息" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "系统消息" }));
    await screen.findByRole("textbox", { name: "直接编辑消息正文：3" });
    expect(container.querySelectorAll(".message--user")).toHaveLength(1);
    expect(container.querySelectorAll(".message--assistant")).toHaveLength(1);
    expect(container.querySelectorAll(".message--system")).toHaveLength(1);
    await act(async () => undefined);
  });
});

describe("editor notices", () => {
  it("shows editor hints in the workbench notice, never inside the toolbar", async () => {
    const { container } = await setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "编辑消息正文：1" }), { key: "Enter" });
    const editor = await screen.findByRole("textbox", { name: "直接编辑消息正文：1" });
    fireEvent.paste(editor, { clipboardData: { files: [], types: ["text/plain", "text/html"], getData: (type: string) => type === "text/plain" ? "粘贴" : "<b>粘贴</b>" } });
    const hint = await screen.findByText("已粘贴为纯文字，网页里的格式和图片没有带过来");
    expect(hint.closest(".workbench-notice")).toHaveAttribute("data-tone", "status");
    expect(container.querySelector(".inline-toolbar .inline-notice")).toBeNull();
  });
});

describe("touch controls", () => {
  it.each(["keydown", "beforeinput"])("backs out of an empty body block through %s and preserves undo and save", async (input) => {
    const document: ConversationDocument = { ...example, messages: [{ ...example.messages[0], blocks: [
      { id: "previous", type: "markdown", source: "前一段正文" },
      { id: "empty", type: "markdown", source: "" },
    ] }] };
    const { container, store } = await setup(document);
    fireEvent.keyDown(screen.getAllByRole("button", { name: "编辑消息正文：1" })[1], { key: "Enter" });
    const editor = await screen.findByRole("textbox", { name: "直接编辑消息正文：1" });
    if (input === "keydown") fireEvent.keyDown(editor, { key: "Backspace" });
    else fireEvent(editor, new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" }));
    await waitFor(() => expect(container.querySelector('[data-workbench-block="empty"]')).toBeNull());
    const previous = await screen.findByRole("textbox", { name: "直接编辑消息正文：1" });
    await waitFor(() => expect(previous).toHaveFocus());
    expect(previous).toHaveTextContent("前一段正文");
    const selection = window.getSelection()!;
    const prefix = textBeforeCaret(previous, selection);
    expect(prefix).toBe("前一段正文");
    fireEvent.keyDown(previous, { key: "z", metaKey: true });
    expect(container.querySelector('[data-workbench-block="empty"]')).toBeInTheDocument();
    fireEvent.keyDown(previous, { key: "z", metaKey: true, shiftKey: true });
    expect(container.querySelector('[data-workbench-block="empty"]')).toBeNull();
    await waitFor(async () => expect(((await store.loadCurrentProject())!.document as ConversationDocument).messages[0].blocks.map(block => block.id)).toEqual(["previous"]));
  });

  it("keeps an empty block while composing and never backs across messages or non-text blocks", async () => {
    const document: ConversationDocument = { ...example, messages: [example.messages[0], { ...example.messages[1], blocks: [
      { id: "first-empty", type: "markdown", source: "" },
      example.messages[1].blocks[1],
      { id: "after-tool", type: "markdown", source: "" },
      { id: "composing-empty", type: "markdown", source: "" },
    ] }] };
    const { container } = await setup(document);
    for (const id of ["first-empty", "after-tool", "composing-empty"]) {
      fireEvent.keyDown(within(container.querySelector(`[data-workbench-block="${id}"]`) as HTMLElement).getByRole("button", { name: "编辑消息正文：2" }), { key: "Enter" });
      const editor = await screen.findByRole("textbox", { name: "直接编辑消息正文：2" });
      if (id === "composing-empty") fireEvent.compositionStart(editor);
      fireEvent.keyDown(editor, { key: "Backspace", isComposing: id === "composing-empty" });
      fireEvent(editor, new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward", isComposing: id === "composing-empty" }));
      expect(container.querySelector(`[data-workbench-block="${id}"]`)).toBeInTheDocument();
    }
    expect(container.querySelectorAll('[data-message-id]')).toHaveLength(2);
    expect(container.querySelector('[data-workbench-block="call"]')).toBeInTheDocument();
  });

  it("marks only the message being edited, so its controls stay tappable after the text loses focus", async () => {
    const { container } = await setup();
    expect(container.querySelectorAll(".workbench-message-tools[data-current]")).toHaveLength(0);
    fireEvent.keyDown(screen.getByRole("button", { name: "编辑消息正文：2" }), { key: "Enter" });
    const editor = await screen.findByRole("textbox", { name: "直接编辑消息正文：2" });
    const marked = () => [...container.querySelectorAll(".workbench-message-tools[data-current]")].map((node) => node.closest("[data-message-id]")?.getAttribute("data-message-id"));
    expect(marked()).toEqual(["assistant"]);
    fireEvent.blur(editor);
    expect(marked()).toEqual(["assistant"]);
  });

  it("adds content from the message menu after choosing an attachment or trace", async () => {
    const { container } = await setup();
    // Nothing floats on the canvas, and nothing to add to until a message is chosen.
    expect(container.querySelector(".workbench-add-block")).toBeNull();
    expect(screen.queryByRole("button", { name: "添加内容" })).toBeNull();
    fireEvent.pointerDown(container.querySelector('[data-workbench-block="call"]')!);
    expect(container.querySelector('[data-message-id="assistant"] .workbench-message-tools')).toHaveAttribute("data-current");
    fireEvent.click(screen.getAllByRole("button", { name: "消息操作" })[1]);
    expect(screen.queryByRole("menuitem", { name: "暂不支持的内容" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "正文" }));
    expect(container.querySelectorAll('[data-message-id="assistant"] [data-workbench-block]')).toHaveLength(4);
  });

  it("offers adding in place once a message has no blocks left", async () => {
    const empty: ConversationDocument = { ...example, messages: [{ ...example.messages[0], blocks: [] }] };
    const { container } = await setup(empty);
    const inPlace = container.querySelector('[data-message-id="user"] .workbench-add-block');
    expect(inPlace).not.toBeNull();
    fireEvent.click(within(inPlace as HTMLElement).getByRole("button", { name: "添加内容" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "正文" }));
    expect(container.querySelectorAll('[data-message-id="user"] [data-workbench-block]')).toHaveLength(1);
  });
});

// Release behaviours that were previously covered only through the retired form workbench.
describe("workbench release behaviour", () => {
  function openDocumentMenu() { fireEvent.click(screen.getByRole("button", { name: "文档" })); }

  it("opens with the simple sample and lists it first, then hides development samples from the public build", async () => {
    render(<App store={new MemoryProjectStore()} showDevelopmentTools={false} />);
    await screen.findByTestId("conversation-canvas");
    expect(screen.getByRole("button", { name: "文档" })).toHaveTextContent("话卷");
    expect(screen.getByRole("button", { name: "编辑标题" })).toHaveTextContent("剩饭放了一夜");
    openDocumentMenu();
    const samples = within(screen.getByRole("group", { name: "示例" })).getAllByRole("menuitem").map((item) => item.textContent);
    expect(samples).toEqual(["载入简洁示例", "载入故事示例"]);
    expect(screen.queryByRole("menuitem", { name: "测试：所有内容类型" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "测试：超长对话" })).not.toBeInTheDocument();
  });

  it("keeps an existing project until a sample is chosen and undoes the replacement", async () => {
    const saved: ConversationDocument = { ...example, metadata: { title: "我的旧项目" } };
    const { container, store } = await setup(saved);
    expect(screen.getByRole("button", { name: "编辑标题" })).toHaveTextContent("我的旧项目");

    openDocumentMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "载入故事示例" }));
    expect(screen.getByRole("button", { name: "编辑标题" })).toHaveTextContent("慢性复活可行性研究");
    expect(container.querySelector('[data-block-id="block-story-sleep-image"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("button", { name: "编辑标题" })).toHaveTextContent("我的旧项目");
    await waitFor(async () => expect((await store.loadCurrentProject())?.document).toEqual(saved));
  });

  it("opens the identity and privacy explanation from the document menu", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    await setup();
    openDocumentMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "关于" }));

    const dialog = await screen.findByRole("dialog", { name: "话卷" });
    expect(dialog).toHaveTextContent("对话只存在这个浏览器里");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("announces a failed autosave and offers a retry", async () => {
    class FailingSaveStore extends MemoryProjectStore {
      failing = false;
      override async saveDocument(...args: Parameters<MemoryProjectStore["saveDocument"]>): Promise<void> {
        if (this.failing) throw new Error("本地存储空间不足");
        return super.saveDocument(...args);
      }
    }
    const store = new FailingSaveStore();
    await setup(example, store);
    store.failing = true;
    openDocumentMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "新建空白" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("本地存储空间不足");
    expect(screen.getByRole("button", { name: "重试保存" })).toBeInTheDocument();
  });
});
