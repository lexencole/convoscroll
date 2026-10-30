import type { ContentBlock, MessageRole } from "../data/conversation-types";

export const roleLabels: Record<MessageRole, string> = {
  user: "用户",
  assistant: "AI 助手",
  system: "系统",
  developer: "开发者",
  tool: "工具",
  unknown: "其他角色",
};

// Status choices use the words the canvas shows, so a setting reads the same as its badge.
export { messageStatusLabels } from "../renderer/MessageRenderer";
export { traceStatusLabels as executionStatusLabels } from "../renderer/TraceBlockView";

export const contentBlockLabels: Record<ContentBlock["type"], string> = {
  file: "文件",
  image: "图片",
  markdown: "Markdown",
  reasoning: "思考过程",
  toolCall: "工具调用",
  toolResult: "工具结果",
  unsupported: "暂不支持的内容",
};
