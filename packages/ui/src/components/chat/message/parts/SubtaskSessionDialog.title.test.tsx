/**
 * The subtask dialog header must follow the session's live title: the tool part
 * only knows the agent type ("Explore"), while the plugin-generated name
 * ("BETA: … (@explore subagent)") arrives later and may change while the dialog
 * stays open. This test mounts the real component against a stubbed sync
 * context whose `useSession` behaves like the real hook — the snapshot is
 * re-read when the session list notifies, so a rename is observed without
 * re-rendering the dialog from the outside.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';

const SESSION_ID = 'ses_child_1';
const AGENT_LABEL = 'Explore';
const SESSION_TITLE = 'BETA: Разбор полей session.tokens (@explore subagent)';

type StoredSession = { id: string; title?: string } | undefined;

const liveSessions = new Map<string, StoredSession>();
const titleListeners = new Set<() => void>();

const publishSessionTitle = (title: string | undefined) => {
  liveSessions.set(SESSION_ID, title === undefined ? undefined : { id: SESSION_ID, title });
  for (const listener of titleListeners) listener();
};

mock.module('@/sync/sync-context', () => ({
  useSession: (sessionId?: string | null) => {
    const subscribe = (notify: () => void) => {
      titleListeners.add(notify);
      return () => {
        titleListeners.delete(notify);
      };
    };
    const getSnapshot = (): StoredSession => (sessionId ? liveSessions.get(sessionId) : undefined);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  },
  useSessionDirectory: () => undefined,
  useEnsureSessionMessages: () => undefined,
  useSessionMessageRecords: () => [],
  useSessionMessageLoadState: () => ({ status: 'complete', complete: true, cursor: undefined }),
  useSessionStatus: () => undefined,
}));

mock.module('@/sync/use-sync', () => ({
  useSync: () => ({ loadMore: async () => undefined }),
}));

mock.module('@/hooks/useEffectiveDirectory', () => ({
  useEffectiveDirectory: () => undefined,
}));

mock.module('@/lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// The transcript viewport is not under test here: only the header is rendered.
mock.module('@/components/chat/MessageList', () => ({ default: () => null }));
mock.module('@/components/chat/ChatEmptyState', () => ({ default: () => null }));
mock.module('@/components/chat/hooks/useChatTimelineController', () => ({
  resolveHistoryScrollThreshold: () => 120,
  shouldAutoLoadEarlierForUnderfilledPinnedViewport: () => false,
}));

// Dialog chrome is replaced by a plain passthrough so the assertion can read
// the header the same way the real dialog renders it: text plus hover tooltip.
mock.module('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) => (
    open ? <>{children}</> : null
  ),
  DialogContent: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DialogTitle: ({ children, className, ...rest }: { children?: React.ReactNode; className?: string; title?: string }) => (
    <h2 data-slot="dialog-title" className={className} {...rest}>{children}</h2>
  ),
}));

const DOM_GLOBAL_NAMES = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'customElements',
  'Node',
  'NodeList',
  'Element',
  'HTMLElement',
  'SVGElement',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'MutationObserver',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;

let container: HTMLElement;
let root: Root;
let restoreDom: () => void = () => undefined;

const readHeader = (): HTMLElement => {
  const header = container.querySelector<HTMLElement>('[data-slot="dialog-title"]');
  if (!header) throw new Error('subtask dialog header is not rendered');
  return header;
};

beforeEach(() => {
  const happyWindow = new Window({ url: 'http://localhost' });
  const previous = DOM_GLOBAL_NAMES.map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  const values = {
    window: happyWindow,
    document: happyWindow.document,
    navigator: happyWindow.navigator,
    localStorage: happyWindow.localStorage,
    customElements: happyWindow.customElements,
    Node: happyWindow.Node,
    NodeList: happyWindow.NodeList,
    Element: happyWindow.Element,
    HTMLElement: happyWindow.HTMLElement,
    SVGElement: happyWindow.SVGElement,
    requestAnimationFrame: happyWindow.requestAnimationFrame.bind(happyWindow),
    cancelAnimationFrame: happyWindow.cancelAnimationFrame.bind(happyWindow),
    getComputedStyle: happyWindow.getComputedStyle.bind(happyWindow),
    MutationObserver: happyWindow.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const name of DOM_GLOBAL_NAMES) {
    Object.defineProperty(globalThis, name, { value: values[name], configurable: true, writable: true });
  }
  restoreDom = () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  liveSessions.clear();
  titleListeners.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  restoreDom();
});

const renderDialog = async () => {
  const { SubtaskSessionDialog } = await import('./SubtaskSessionDialog');
  root = createRoot(container);
  act(() => {
    root.render(
      <SubtaskSessionDialog open onOpenChange={() => undefined} sessionId={SESSION_ID} title={AGENT_LABEL} directory="/repo" />,
    );
  });
};

describe('SubtaskSessionDialog header title', () => {
  test('shows the agent label until the session is loaded', async () => {
    await renderDialog();

    expect(readHeader().textContent).toBe(AGENT_LABEL);
    expect(readHeader().getAttribute('title')).toBe(AGENT_LABEL);
  });

  test('shows the live session title and keeps it inside the header box', async () => {
    await renderDialog();

    act(() => publishSessionTitle(SESSION_TITLE));

    expect(readHeader().textContent).toBe(SESSION_TITLE);
    expect(readHeader().getAttribute('title')).toBe(SESSION_TITLE);
    expect(readHeader().className).toContain('truncate');
  });

  test('replaces the header when the plugin renames the open session', async () => {
    act(() => publishSessionTitle(SESSION_TITLE));
    await renderDialog();

    act(() => publishSessionTitle('Renamed while the dialog is open'));

    expect(readHeader().textContent).toBe('Renamed while the dialog is open');
  });

  test('shows the session id under the header so the subagent stays identifiable', async () => {
    await renderDialog();

    const id = container.querySelector<HTMLElement>('[data-slot="subtask-session-id"]');
    expect(id?.textContent).toBe(SESSION_ID);
    expect(id?.getAttribute('title')).toBe(SESSION_ID);
    expect(id?.className).toContain('select-all');
  });

  test('falls back to the agent label when the session keeps the placeholder title', async () => {
    act(() => publishSessionTitle(SESSION_TITLE));
    await renderDialog();

    act(() => publishSessionTitle('New session - 42'));

    expect(readHeader().textContent).toBe(AGENT_LABEL);
  });
});
