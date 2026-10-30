import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument } from '../editor/document-operations';
import { MessageNavigator } from './MessageNavigator';
const conversation = { ...createEmptyDocument(), messages: [
  { id: 'one', role: 'user' as const, displayName: '读者', blocks: [{ id: 'a', type: 'markdown' as const, source: '第一段' }] },
  { id: 'two', role: 'assistant' as const, displayName: '助手', blocks: [{ id: 'b', type: 'markdown' as const, source: '第二段' }] },
] };
function setup() {
  const canvas = createRef<HTMLElement>();
  const view = render(<><div className="workbench-chrome" /><section ref={canvas}>{conversation.messages.map((message) => <article key={message.id} data-message-id={message.id} />)}</section><MessageNavigator document={conversation} canvas={canvas} disabled={false} /></>);
  const articles = canvas.current!.querySelectorAll('article');
  vi.spyOn(articles[0], 'getBoundingClientRect').mockReturnValue({ top: 120 } as DOMRect);
  vi.spyOn(articles[1], 'getBoundingClientRect').mockReturnValue({ top: 520 } as DOMRect);
  return { ...view, canvas, articles };
}
const originalMatchMedia = window.matchMedia;
afterEach(() => { vi.restoreAllMocks(); window.matchMedia = originalMatchMedia; });
describe('message navigator', () => {
  it('moves keyboard focus separately from reading position and jumps below the toolbar', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    setup();
    const first = screen.getByRole('button', { name: '跳到消息 1：读者' });
    const second = screen.getByRole('button', { name: '跳到消息 2：助手' });
    act(() => first.focus()); fireEvent.keyDown(first, { key: 'End' });
    expect(second).toHaveFocus(); expect(first).toHaveAttribute('aria-current', 'location');
    expect(screen.getByRole('tooltip')).toHaveTextContent('第二段');
    fireEvent.keyDown(second, { key: 'Escape' }); expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(second); await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith({ top: 504, behavior: 'instant' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });
  it('tracks scroll and geometry changes without changing focus', async () => {
    const { articles } = setup();
    const first = screen.getByRole('button', { name: '跳到消息 1：读者' });
    act(() => first.focus());
    vi.spyOn(articles[0], 'getBoundingClientRect').mockReturnValue({ top: -390 } as DOMRect);
    vi.spyOn(articles[1], 'getBoundingClientRect').mockReturnValue({ top: 10 } as DOMRect);
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.getByRole('button', { name: '跳到消息 2：助手' })).toHaveAttribute('aria-current', 'location'));
    expect(first).toHaveFocus();
  });
  it('isolates the mobile list, loops focus and restores the trigger on Escape', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: '打开消息目录' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '消息目录' });
    const rows = within(dialog).getAllByRole('button');
    await waitFor(() => expect(rows[1]).toHaveFocus());
    expect(document.querySelector('[data-message-id]')?.closest('[inert]')).not.toBeNull();
    fireEvent.keyDown(rows[1], { key: 'End' }); expect(rows.at(-1)).toHaveFocus();
    fireEvent.keyDown(rows.at(-1)!, { key: 'Tab' }); expect(rows[0]).toHaveFocus();
    fireEvent.keyDown(rows[0], { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.querySelector('[inert]')).toBeNull();
  });
  it('returns focus to the visible desktop entry after the mobile trigger is hidden by resize', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: '打开消息目录' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '消息目录' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    trigger.style.display = 'none';
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: '跳到消息 1：读者' })).toHaveFocus());
  });
  it('disables navigation during protected operations and removes stale entries', () => {
    const { canvas, rerender } = setup();
    rerender(<MessageNavigator document={conversation} canvas={canvas} disabled />);
    screen.getAllByRole('button').forEach((button) => expect(button).toBeDisabled());
    rerender(<MessageNavigator document={{ ...conversation, messages: [conversation.messages[1]] }} canvas={canvas} disabled={false} />);
    expect(screen.queryByRole('button', { name: /消息 1：读者/ })).toBeNull();
    expect(screen.getByRole('button', { name: '跳到消息 1：助手' })).toHaveAttribute('aria-current', 'location');
    rerender(<MessageNavigator document={{ ...conversation, messages: [] }} canvas={canvas} disabled={false} />);
    expect(screen.queryByRole('navigation')).toBeNull(); expect(screen.queryByRole('button')).toBeNull();
  });
});
