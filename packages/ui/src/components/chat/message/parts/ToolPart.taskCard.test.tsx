/**
 * The transcript task card names the subagent; it does not repeat the task.
 *
 * `input.description` (`probe H`) is what the calling agent typed, while the
 * child session's own title (`QUEBEC: probe H`) is the subagent's name. The
 * card must show the latter and fall back to the capitalized `subagent_type`
 * until the server-side rename lands, with the caller's task text kept as the
 * row tooltip. This mounts the real `ToolPart` against the real sync context so
 * `session.updated` reaches the card through `useSession` without any outer
 * re-render.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { StoreApi } from 'zustand';
import type { DirectoryStore } from '@/sync/child-store';
import type { State } from '@/sync/types';

const SESSION_ID = 'ses_child_probe';
const DIRECTORY = '/repo';
const TASK_DESCRIPTION = 'probe H';
// The tooltip carries the caller's task text plus the child session id, so the
// subagent stays identifiable after the plugin renames its session.
const CARD_TOOLTIP = `${TASK_DESCRIPTION}\nid: ${SESSION_ID}`;

// The transcript body is not under test here, and the real markdown renderer
// pulls a shiki web worker that cannot load under bun test.
mock.module('@/components/chat/markdown/markdown-worker', () => ({
  resetMarkdownWorkerClientCacheForTests: () => undefined,
  highlightCodeInWorker: async () => null,
  highlightLinesInWorker: async () => null,
  getCachedHighlightedLines: () => null,
  highlightTokensInWorker: async () => null,
}));

// Vite-only asset lookup; the card title does not depend on provider logos.
mock.module('@/hooks/useProviderLogo', () => ({
  useProviderLogo: () => null,
}));

// The card resolves the child session in the active directory; the transcript
// container that normally supplies it is not part of this fixture.
mock.module('@/hooks/useEffectiveDirectory', () => ({
  useEffectiveDirectory: () => DIRECTORY,
}));

// The dialog has its own header test; here its closed instance only adds
// message-load subscriptions that are irrelevant to the card row.
const subtaskDialogStub = () => ({ default: () => null, SubtaskSessionDialog: () => null });
mock.module('./SubtaskSessionDialog', subtaskDialogStub);
mock.module('@/components/chat/message/parts/SubtaskSessionDialog', subtaskDialogStub);

const { ChildStoreManager } = await import('@/sync/child-store');
const { I18nProvider } = await import('@/lib/i18n');
const { default: ToolPart } = await import('./ToolPart');

// SAFETY: sync-context.tsx publishes these two context identities on
// globalThis so every module instance shares them.
const syncGlobals = globalThis as {
  __openchamber_sync_context__?: React.Context<unknown>;
  __openchamber_sync_runtime_context__?: React.Context<unknown>;
};
const syncContext = syncGlobals.__openchamber_sync_context__;
const syncRuntimeContext = syncGlobals.__openchamber_sync_runtime_context__;
if (!syncContext || !syncRuntimeContext) {
  throw new Error('sync contexts were not published on globalThis by @/sync/sync-context');
}

// SAFETY: the sync store owns this shape on the wire (id/directory/title/time);
// the fixture spells only the fields the card reads.
const buildSession = (id: string, title: string) => ({
  id,
  slug: id,
  projectID: 'project-1',
  directory: DIRECTORY,
  title,
  version: '1',
  time: { created: 1, updated: 1 },
} as State['session'][number]);

// SAFETY: the task tool part shape is owned by the SDK; the fixture spells only
// the fields the card reads (`state.input`, `state.metadata.sessionId`).
const buildTaskPart = (subagentType: string | undefined): React.ComponentProps<typeof ToolPart>['part'] => ({
  id: 'part-task-1',
  sessionID: 'ses_parent',
  messageID: 'msg-1',
  type: 'tool',
  callID: 'call-1',
  tool: 'task',
  state: {
    status: 'completed',
    input: { subagent_type: subagentType, description: TASK_DESCRIPTION },
    output: '',
    title: '',
    metadata: { sessionId: SESSION_ID },
    time: { start: 1, end: 2 },
  },
});

const DOM_GLOBAL_NAMES = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'Element',
  'SVGElement',
  'Node',
  'NodeList',
  'MutationObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'ResizeObserver',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;

let container: HTMLElement;
let root: Root;
let restoreDom: () => void = () => undefined;
let store: StoreApi<DirectoryStore>;
let renderCard: (subagentType: string | undefined) => Promise<void>;

const readCardTitle = (): HTMLElement => {
  const title = container.querySelector<HTMLElement>('[data-slot="task-card-title"]');
  if (!title) throw new Error('task card title is not rendered');
  return title;
};

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  const globals = {
    window: win,
    document: win.document,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    SVGElement: win.SVGElement,
    Node: win.Node,
    NodeList: win.NodeList,
    MutationObserver: win.MutationObserver,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    ResizeObserver: class {
      observe() { return undefined; }
      unobserve() { return undefined; }
      disconnect() { return undefined; }
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = DOM_GLOBAL_NAMES.map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const name of DOM_GLOBAL_NAMES) {
    Object.defineProperty(globalThis, name, { value: globals[name], configurable: true, writable: true });
  }
  restoreDom = () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  const childStores = new ChildStoreManager();
  store = childStores.ensureChild(DIRECTORY, { bootstrap: false });
  // The subtask dialog is mounted closed; its message-load subscription still
  // runs, so the loader needs the two methods `useSyncExternalStore` calls.
  const messageLoader = {
    getSnapshot: () => ({
      status: 'complete',
      loadingKind: null,
      error: null,
      resolved: true,
      limit: 0,
      cursor: undefined,
      complete: true,
      generation: 0,
      updatedAt: undefined,
    }),
    subscribe: () => () => undefined,
  };
  const system = { childStores, messageLoader, sdk: {}, runtimeKey: 'test', directory: DIRECTORY };
  const runtime = {
    childStores,
    messageLoader,
    sdk: {},
    runtimeKey: 'test',
    currentDirectory: { get: () => DIRECTORY, subscribe: () => () => undefined },
  };

  renderCard = async (subagentType: string | undefined) => {
    await act(async () => {
      root.render(
        React.createElement(
          syncContext.Provider,
          { value: system },
          React.createElement(
            syncRuntimeContext.Provider,
            { value: runtime },
            React.createElement(
              I18nProvider,
              null,
              React.createElement(ToolPart, {
                part: buildTaskPart(subagentType),
                isExpanded: false,
                onToggle: () => undefined,
                isMobile: false,
              }),
            ),
          ),
        ),
      );
    });
    await settle();
  };
});

// The card defers its expanded body through a transition; settle the queued
// work so the row's DOM is committed before an assertion reads it.
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  restoreDom();
});

describe('transcript task card title', () => {
  test('shows the child session title, not the task description, and keeps the description and id as the tooltip', async () => {
    store.setState({ session: [buildSession(SESSION_ID, 'New session - 2026-02-14T09:12:00')] });
    await renderCard('explore');

    expect(readCardTitle().textContent).toBe('Explore');
    expect(readCardTitle().getAttribute('title')).toBe(CARD_TOOLTIP);

    // The server rename arrives as a session update on the child store.
    await act(async () => {
      store.setState({ session: [buildSession(SESSION_ID, 'QUEBEC: probe H')] });
    });
    await settle();

    expect(readCardTitle().textContent).toBe('QUEBEC: probe H');
    expect(readCardTitle().textContent).not.toBe(TASK_DESCRIPTION);
    expect(readCardTitle().getAttribute('title')).toBe(CARD_TOOLTIP);

    // A sibling session updating must not re-title this card.
    await act(async () => {
      store.setState({
        session: [buildSession(SESSION_ID, 'QUEBEC: probe H'), buildSession('ses_other', 'Sibling renamed')],
      });
    });
    await settle();

    expect(readCardTitle().textContent).toBe('QUEBEC: probe H');
  });

  test('falls back to the capitalized subagent_type while the child session is unknown', async () => {
    await renderCard('reviewer');

    expect(readCardTitle().textContent).toBe('Reviewer');

    await renderCard(undefined);

    expect(readCardTitle().textContent).toBe('Subagent');
  });
});
