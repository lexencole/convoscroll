import { useEffect, type RefObject } from "react";

interface ElementIsolationState {
  count: number;
  readonly hadInert: boolean;
  readonly ariaHidden: string | null;
}

interface ScrollLockState {
  count: number;
  readonly rootOverflow: string;
}

const isolatedElements = new WeakMap<HTMLElement, ElementIsolationState>();
const lockedDocuments = new WeakMap<Document, ScrollLockState>();

function acquireElementIsolation(element: HTMLElement) {
  const current = isolatedElements.get(element);
  if (current) {
    current.count += 1;
    return;
  }

  isolatedElements.set(element, {
    count: 1,
    hadInert: element.hasAttribute("inert"),
    ariaHidden: element.getAttribute("aria-hidden"),
  });
  element.setAttribute("inert", "");
  element.setAttribute("aria-hidden", "true");
}

function releaseElementIsolation(element: HTMLElement) {
  const current = isolatedElements.get(element);
  if (!current) return;
  current.count -= 1;
  if (current.count > 0) return;

  if (!current.hadInert) element.removeAttribute("inert");
  if (current.ariaHidden === null) element.removeAttribute("aria-hidden");
  else element.setAttribute("aria-hidden", current.ariaHidden);
  isolatedElements.delete(element);
}

function isolateBackground(modal: HTMLElement) {
  const isolated: HTMLElement[] = [];
  let branch: HTMLElement = modal;

  while (branch.parentElement) {
    const parent = branch.parentElement;
    for (const sibling of parent.children) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      acquireElementIsolation(sibling);
      isolated.push(sibling);
    }
    if (parent === modal.ownerDocument.body) break;
    branch = parent;
  }

  return () => {
    for (let index = isolated.length - 1; index >= 0; index -= 1) {
      releaseElementIsolation(isolated[index]);
    }
  };
}

function lockDocumentScroll(ownerDocument: Document) {
  const current = lockedDocuments.get(ownerDocument);
  if (current) {
    current.count += 1;
  } else {
    // Lock the root only: its overflow governs the viewport. Hiding body as well
    // would make body a scroll container and detach sticky workbench chrome.
    const root = ownerDocument.documentElement;
    lockedDocuments.set(ownerDocument, { count: 1, rootOverflow: root.style.overflow });
    root.style.overflow = "hidden";
  }

  return () => {
    const state = lockedDocuments.get(ownerDocument);
    if (!state) return;
    state.count -= 1;
    if (state.count > 0) return;

    ownerDocument.documentElement.style.overflow = state.rootOverflow;
    lockedDocuments.delete(ownerDocument);
  };
}

/**
 * Keeps a modal's DOM branch interactive while removing every background
 * sibling from focus and the accessibility tree. Existing attributes and
 * scroll styles are restored exactly when the modal closes or unmounts.
 */
export function useModalIsolation(
  active: boolean,
  modalRef: RefObject<HTMLElement | null>,
  { lockScroll = true }: { readonly lockScroll?: boolean } = {},
) {
  useEffect(() => {
    if (!active) return;
    const modal = modalRef.current;
    if (!modal) return;

    const releaseBackground = isolateBackground(modal);
    const releaseScroll = lockScroll ? lockDocumentScroll(modal.ownerDocument) : () => undefined;
    return () => {
      releaseBackground();
      releaseScroll();
    };
  }, [active, modalRef, lockScroll]);
}
