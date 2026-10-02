import { beforeEach, describe, expect, mock, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';

// Only the pieces the controls touch. The store itself is covered by
// useSessionCollapseStore.test.ts; here we assert the buttons render and wire
// to the store actions.
const knownProjectIds = ['project-a'];
let collapseAllCalls = 0;
let expandAllCalls = 0;

const collapseState = {
  knownProjectIds,
  collapseAll: () => { collapseAllCalls += 1; },
  expandAll: () => { expandAllCalls += 1; },
};

mock.module('@/stores/useSessionCollapseStore', () => ({
  useSessionCollapseStore: <T,>(selector: (state: typeof collapseState) => T): T => selector(collapseState),
}));
mock.module('@/lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
mock.module('@/components/icon/Icon', () => ({
  Icon: ({ name }: { name: string }) => React.createElement('span', { 'data-icon': name }),
}));

const { VSCodeProjectCollapseControls } = await import('./VSCodeProjectCollapseControls');

describe('VSCodeProjectCollapseControls', () => {
  let windowInstance: Window;
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    windowInstance = new Window({ url: 'http://localhost/' });
    Object.assign(globalThis, {
      window: windowInstance,
      document: windowInstance.document,
      navigator: windowInstance.navigator,
      Node: windowInstance.Node,
      Element: windowInstance.Element,
      HTMLElement: windowInstance.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    collapseAllCalls = 0;
    expandAllCalls = 0;
    collapseState.knownProjectIds = knownProjectIds;
  });

  const render = async () => {
    await act(async () => { root.render(React.createElement(VSCodeProjectCollapseControls)); });
  };

  test('renders collapse-all and expand-all from the store', async () => {
    await render();
    const buttons = Array.from(host.querySelectorAll('button'));
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'sessions.sidebar.header.displayMode.collapseAll',
      'sessions.sidebar.header.displayMode.expandAll',
    ]);
    expect(buttons.map((button) => button.querySelector('span')?.getAttribute('data-icon'))).toEqual([
      'contract-up-down',
      'expand-up-down',
    ]);
    await act(async () => root.unmount());
  });

  test('click invokes the matching store action', async () => {
    await render();
    const buttons = Array.from(host.querySelectorAll('button'));
    await act(async () => { buttons[0].click(); });
    expect(collapseAllCalls).toBe(1);
    expect(expandAllCalls).toBe(0);
    await act(async () => { buttons[1].click(); });
    expect(expandAllCalls).toBe(1);
    await act(async () => root.unmount());
  });

  test('renders nothing until the sidebar registers a project', async () => {
    collapseState.knownProjectIds = [];
    await render();
    expect(host.querySelectorAll('button')).toHaveLength(0);
    await act(async () => root.unmount());
  });
});
