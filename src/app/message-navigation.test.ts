import { describe, expect, it } from "vitest";
import type { ContentBlock, ConversationDocument } from "../data/conversation-types";
import { createEmptyDocument } from "../editor/document-operations";
import { messageNavigationEntries } from "./message-navigation";
const withBlocks = (blocks: readonly ContentBlock[]): ConversationDocument => ({ ...createEmptyDocument(), messages: [{ id: 'one', role: 'assistant', displayName: '小卷', blocks }] });
describe('message navigation summaries', () => {
  it('projects Markdown labels without markup, link URLs, definitions or HTML', () => {
    const entries = messageNavigationEntries(withBlocks([{ id: 'text', type: 'markdown', source: '# 标题\n\n**粗体**与[链接](https://example.com/private) ![示意](https://example.com/image)\n\n<script>unsafe()</script>\n\n[ref]: https://example.com/secret' }]));
    expect(entries[0].summary).toBe('标题 粗体与链接 示意');
    expect(entries[0]).toMatchObject({ id: 'one', name: '小卷', role: 'AI 助手', index: 0 });
  });
  it('describes non-text blocks and missing assets without serializing tool data', () => {
    const document = withBlocks([
      { id: 'image', type: 'image', assetId: 'photo' }, { id: 'file', type: 'file', assetId: 'missing' },
      { id: 'reason', type: 'reasoning', source: '隐藏正文', summary: '已核对', displayState: 'collapsed', exportState: 'current' },
      { id: 'call', type: 'toolCall', callId: 'call', toolName: '计算', input: { secret: '不要展开' }, status: 'success', displayState: 'collapsed', exportState: 'current' },
      { id: 'result', type: 'toolResult', callId: 'call', output: { secret: '不要展开' }, status: 'success', displayState: 'collapsed', exportState: 'current' },
      { id: 'unknown', type: 'unsupported', originalType: 'widget', raw: { secret: '不要展开' } },
    ]);
    const entry = messageNavigationEntries({ ...document, assets: [{ id: 'photo', kind: 'image', fileName: '照片.png', mimeType: 'image/png', source: { kind: 'local', storageKey: 'photo' } }] })[0];
    expect(entry.summary).toBe('图片 · 照片.png 文件 · 附件缺失 思考过程 · 已核对 工具调用 · 计算 工具结果 暂不支持的内容 · widget');
  });
  it('follows stable IDs through reorder, content edits and empty messages', () => {
    const document = withBlocks([{ id: 'a', type: 'markdown', source: '旧文字' }]);
    const empty = { id: 'two', role: 'system' as const, blocks: [] };
    expect(messageNavigationEntries({ ...document, messages: [empty, document.messages[0]] }).map(({ id, index, summary }) => ({ id, index, summary }))).toEqual([{ id: 'two', index: 0, summary: '空消息' }, { id: 'one', index: 1, summary: '旧文字' }]);
    expect(messageNavigationEntries(withBlocks([{ id: 'a', type: 'markdown', source: '新文字' }]))[0].summary).toBe('新文字');
    expect(messageNavigationEntries({ ...document, messages: [] })).toEqual([]);
  });
  it('bounds very long input and keeps code and formula text readable', () => {
    expect(messageNavigationEntries(withBlocks([{ id: 'a', type: 'markdown', source: '```js\nreturn 42;\n```\n\n$x^2$' }]))[0].summary).toBe('return 42; x^2');
    expect(messageNavigationEntries(withBlocks([{ id: 'a', type: 'markdown', source: '很长的内容'.repeat(10000) }]))[0].summary).toHaveLength(160);
  });
});
