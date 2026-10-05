import { beforeEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { getDeferredSafeStorage } from '@/stores/utils/safeStorage';
import { useSessionCollapseStore } from '@/stores/useSessionCollapseStore';
import type { SessionGroup } from '../types';
import { useSessionProjectViewState } from './useSessionProjectViewState';

class ElementStub implements Partial<Element> {
  nodeType = 1;
}
type DocumentStub = {
  nodeType: number;
  defaultView: typeof globalThis;
  activeElement: null;
  addEventListener: () => void;
  removeEventListener: () => void;
  documentElement?: Element;
  body?: Element;
};
type GlobalValue = typeof globalThis | typeof ElementStub | DocumentStub | boolean;
type HookCapture = {
  state?: ReturnType<typeof useSessionProjectViewState>['state'];
  actions?: ReturnType<typeof useSessionProjectViewState>['actions'];
  renderCount: number;
};

const installMinimalDom = () => {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const setGlobal = (name: string, value: GlobalValue) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const documentStub: DocumentStub = {
    nodeType: 9,
    defaultView: globalThis,
    activeElement: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  // SAFETY: React's test renderer only inspects this fixture's DOM identity fields and listeners.
  const container = Object.create(ElementStub.prototype) as Element;
  Object.assign(container, {
    nodeType: 1,
    tagName: 'DIV',
    nodeName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: documentStub,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  documentStub.documentElement = container;
  documentStub.body = container;
  setGlobal('document', documentStub);
  setGlobal('window', globalThis);
  setGlobal('Element', ElementStub);
  setGlobal('HTMLElement', ElementStub);
  setGlobal('HTMLIFrameElement', ElementStub);
  setGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  return {
    container,
    restore: () => {
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
};

const group = (id: string): SessionGroup => ({
  id,
  label: id,
  branch: null,
  description: null,
  isMain: false,
  worktree: null,
  directory: null,
  sessions: [],
});

const mountViewState = async (args: {
  projects: readonly { id: string }[];
  activeProjectId?: string | null;
}) => {
  await useSessionCollapseStore.persist.rehydrate();
  const dom = installMinimalDom();
  const root: Root = createRoot(dom.container);
  const capture: HookCapture = { renderCount: 0 };
  const Harness = ({ projects }: { projects: readonly { id: string }[] }) => {
    capture.renderCount += 1;
    const value = useSessionProjectViewState({
      projects,
      activeProjectId: args.activeProjectId ?? null,
    });
    capture.state = value.state;
    capture.actions = value.actions;
    return null;
  };
  await act(async () => root.render(React.createElement(Harness, { projects: args.projects })));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { capture, root, dom, Harness };
};

describe('useSessionProjectViewState', () => {
  beforeEach(() => {
    const storage = getDeferredSafeStorage();
    storage.removeItem('oc.sessions.projectCollapse');
    storage.removeItem('oc.sessions.projectExpand');
    storage.removeItem('oc.sessions.groupCollapse');
    storage.removeItem('oc.sessions.groupOrder');
    // Collapse state lives in a module-level store; reset it to match the
    // cleared storage so tests stay independent.
    useSessionCollapseStore.setState({
      collapsedProjectIds: [],
      expandedProjectIds: [],
      knownProjectIds: [],
    });
  });

  test('keeps stable state/actions and ignores selection-store updates', async () => {
    const { capture, root, dom } = await mountViewState({
      projects: [{ id: 'project-a' }, { id: 'project-b' }],
      activeProjectId: 'project-a',
    });

    try {
      const initialState = capture.state;
      const initialActions = capture.actions;
      const initialRenderCount = capture.renderCount;
      if (!initialState || !initialActions) throw new Error('hook did not mount');

      await act(async () => {
        useSessionUIStore.setState({ currentSessionId: 'selection-only' });
      });
      expect(capture.renderCount).toBe(initialRenderCount);
      expect(capture.state).toBe(initialState);
      expect(capture.actions).toBe(initialActions);

      await act(async () => initialActions.toggleProject('project-b'));
      expect(capture.state?.collapsedProjects).toEqual(new Set());
      expect(capture.state?.collapsedProjects.has('project-b')).toBe(false);

      await act(async () => initialActions.collapseAllProjects());
      expect(capture.state?.collapsedProjects).toEqual(new Set(['project-b']));
      await act(async () => initialActions.expandAllProjects());
      expect(capture.state?.collapsedProjects).toEqual(new Set());

      await act(async () => initialActions.toggleGroup('project-a:group-a'));
      expect(capture.state?.collapsedGroups).toEqual(new Set(['project-a:group-a']));

      await act(async () => {
        initialActions.setGroupOrderByProject((previous) => {
          const next = new Map(previous);
          next.set('project-a', ['group-b', 'group-a']);
          return next;
        });
      });
      expect(capture.actions?.getOrderedGroups('project-a', [group('group-a'), group('group-b')])
        .map((item) => item.id)).toEqual(['group-b', 'group-a']);

      await new Promise((resolve) => setTimeout(resolve, 0));
      const storage = getDeferredSafeStorage();
      expect(JSON.parse(storage.getItem('oc.sessions.groupCollapse') ?? 'null')).toEqual(['project-a:group-a']);
      expect(JSON.parse(storage.getItem('oc.sessions.groupOrder') ?? 'null')).toEqual({
        'project-a': ['group-b', 'group-a'],
      });
    } finally {
      await act(async () => root.unmount());
      dom.restore();
    }
  });

  test('preserves malformed group storage until explicit user mutation', async () => {
    const storage = getDeferredSafeStorage();
    const malformedCollapse = '{malformed-collapse';
    const malformedOrder = JSON.stringify({ 'project-a': ['group-a', 2] });
    storage.setItem('oc.sessions.groupCollapse', malformedCollapse);
    storage.setItem('oc.sessions.groupOrder', malformedOrder);
    const dom = installMinimalDom();
    const root = createRoot(dom.container);
    const capture: HookCapture = { renderCount: 0 };
    const Harness = () => {
      capture.renderCount += 1;
      const value = useSessionProjectViewState({ projects: [{ id: 'project-a' }], activeProjectId: 'project-a' });
      capture.state = value.state;
      capture.actions = value.actions;
      return null;
    };

    try {
      await act(async () => root.render(React.createElement(Harness)));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(capture.state?.collapsedGroups).toEqual(new Set());
      expect(capture.state?.groupOrderByProject).toEqual(new Map());
      expect(storage.getItem('oc.sessions.groupCollapse')).toBe(malformedCollapse);
      expect(storage.getItem('oc.sessions.groupOrder')).toBe(malformedOrder);

      await act(async () => capture.actions!.toggleGroup('project-a:group-a'));
      await act(async () => capture.actions!.setGroupOrderByProject(new Map([['project-a', ['group-a']]])));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(JSON.parse(storage.getItem('oc.sessions.groupCollapse') ?? 'null')).toEqual(['project-a:group-a']);
      expect(JSON.parse(storage.getItem('oc.sessions.groupOrder') ?? 'null')).toEqual({ 'project-a': ['group-a'] });
    } finally {
      await act(async () => root.unmount());
      dom.restore();
    }
  });

  test('retains persisted project/group state while hidden and across a full remount', async () => {
    const storage = getDeferredSafeStorage();
    storage.setItem('oc.sessions.projectCollapse', JSON.stringify(['project-a']));
    storage.setItem('oc.sessions.groupCollapse', JSON.stringify(['project-a:group-a']));
    storage.setItem('oc.sessions.groupOrder', JSON.stringify({ 'project-a': ['group-b', 'group-a'] }));
    await useSessionCollapseStore.persist.rehydrate();
    const dom = installMinimalDom();
    const root = createRoot(dom.container);
    const capture: HookCapture = { renderCount: 0 };
    const Harness = ({ hidden }: { hidden: boolean }) => {
      void hidden;
      capture.renderCount += 1;
      const value = useSessionProjectViewState({ projects: [{ id: 'project-a' }], activeProjectId: null });
      capture.state = value.state;
      capture.actions = value.actions;
      return null;
    };

    try {
      await act(async () => root.render(React.createElement(Harness, { hidden: false })));
      await act(async () => root.render(React.createElement(Harness, { hidden: true })));
      await act(async () => root.render(React.createElement(Harness, { hidden: false })));
      expect(capture.state?.collapsedProjects).toEqual(new Set(['project-a']));
      expect(capture.state?.collapsedGroups).toEqual(new Set(['project-a:group-a']));
      expect(capture.state?.groupOrderByProject).toEqual(new Map([['project-a', ['group-b', 'group-a']]]));

      await act(async () => root.render(null));
      await act(async () => root.render(React.createElement(Harness, { hidden: false })));
      expect(capture.state?.collapsedProjects).toEqual(new Set(['project-a']));
      expect(capture.state?.collapsedGroups).toEqual(new Set(['project-a:group-a']));
      expect(capture.state?.groupOrderByProject).toEqual(new Map([['project-a', ['group-b', 'group-a']]]));
    } finally {
      await act(async () => root.unmount());
      dom.restore();
    }
  });

  test('opens a several-project list on the active project with nothing stored', async () => {
    // The regression this replaces: an empty collapse list combined with a
    // leftover "user already chose" marker used to leave every project open.
    const { capture, root, dom } = await mountViewState({
      projects: [{ id: 'project-a' }, { id: 'project-b' }, { id: 'project-c' }],
      activeProjectId: 'project-b',
    });

    try {
      expect(capture.state?.collapsedProjects).toEqual(new Set(['project-a', 'project-c']));
    } finally {
      await act(async () => root.unmount());
      dom.restore();
    }
  });

  test('folds a project that appears after the first snapshot', async () => {
    // VS Code knows the workspace folder immediately but discovers projects
    // from the session database later. Those have to arrive folded too.
    const { capture, root, dom, Harness } = await mountViewState({
      projects: [{ id: 'project-a' }],
      activeProjectId: 'project-a',
    });

    try {
      expect(capture.state?.collapsedProjects).toEqual(new Set());

      await act(async () => root.render(React.createElement(Harness, {
        projects: [{ id: 'project-a' }, { id: 'project-b' }],
      })));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(capture.state?.collapsedProjects).toEqual(new Set(['project-b']));
    } finally {
      await act(async () => root.unmount());
      dom.restore();
    }
  });

  test('leaves a single-project list alone', async () => {
    const { capture, root, dom } = await mountViewState({
      projects: [{ id: 'project-a' }],
      activeProjectId: 'project-a',
    });

    try {
      expect(capture.state?.collapsedProjects).toEqual(new Set());
    } finally {
      await act(async () => root.unmount());
      dom.restore();
    }
  });

  test('collapses everything when no project is active', async () => {
    const { capture, root, dom } = await mountViewState({
      projects: [{ id: 'project-a' }, { id: 'project-b' }],
    });

    try {
      expect(capture.state?.collapsedProjects).toEqual(new Set(['project-a', 'project-b']));
    } finally {
      await act(async () => root.unmount());
      dom.restore();
    }
  });

  test('keeps an expanded layout on the next run after expand all', async () => {
    const first = await mountViewState({
      projects: [{ id: 'project-a' }, { id: 'project-b' }],
      activeProjectId: 'project-a',
    });
    try {
      expect(first.capture.state?.collapsedProjects).toEqual(new Set(['project-b']));
      await act(async () => first.capture.actions!.expandAllProjects());
      expect(first.capture.state?.collapsedProjects).toEqual(new Set());
    } finally {
      await act(async () => first.root.unmount());
      first.dom.restore();
    }

    const second = await mountViewState({
      projects: [{ id: 'project-a' }, { id: 'project-b' }],
      activeProjectId: 'project-a',
    });
    try {
      expect(second.capture.state?.collapsedProjects).toEqual(new Set());
    } finally {
      await act(async () => second.root.unmount());
      second.dom.restore();
    }
  });

  test('keeps a project the user unfolded by hand across a remount', async () => {
    const first = await mountViewState({
      projects: [{ id: 'project-a' }, { id: 'project-b' }],
      activeProjectId: 'project-a',
    });
    try {
      expect(first.capture.state?.collapsedProjects).toEqual(new Set(['project-b']));
      await act(async () => first.capture.actions!.toggleProject('project-b'));
      expect(first.capture.state?.collapsedProjects).toEqual(new Set());
    } finally {
      await act(async () => first.root.unmount());
      first.dom.restore();
    }

    const second = await mountViewState({
      projects: [{ id: 'project-a' }, { id: 'project-b' }],
      activeProjectId: 'project-a',
    });
    try {
      // Opening a project by hand is a decision, and it survives a restart.
      expect(second.capture.state?.collapsedProjects).toEqual(new Set());
    } finally {
      await act(async () => second.root.unmount());
      second.dom.restore();
    }
  });

  test('a project folded by hand stays folded on the next run', async () => {
    const first = await mountViewState({
      projects: [{ id: 'project-a' }, { id: 'project-b' }],
      activeProjectId: 'project-a',
    });
    try {
      await act(async () => first.capture.actions!.toggleProject('project-b'));
      expect(first.capture.state?.collapsedProjects).toEqual(new Set());
      await act(async () => first.capture.actions!.toggleProject('project-b'));
      expect(first.capture.state?.collapsedProjects).toEqual(new Set(['project-b']));
    } finally {
      await act(async () => first.root.unmount());
      first.dom.restore();
    }

    const second = await mountViewState({
      projects: [{ id: 'project-a' }, { id: 'project-b' }],
      activeProjectId: 'project-a',
    });
    try {
      expect(second.capture.state?.collapsedProjects).toEqual(new Set(['project-b']));
    } finally {
      await act(async () => second.root.unmount());
      second.dom.restore();
    }
  });

  test('never folds the project the user is working in', async () => {
    const { capture, root, dom } = await mountViewState({
      projects: [{ id: 'project-a' }, { id: 'project-b' }],
      activeProjectId: 'project-b',
    });

    try {
      await act(async () => capture.actions!.toggleProject('project-b'));
      expect(capture.state?.collapsedProjects).toEqual(new Set(['project-a']));

      await act(async () => capture.actions!.collapseAllProjects());
      expect(capture.state?.collapsedProjects).toEqual(new Set(['project-a']));
      expect(capture.state?.collapsedProjects.has('project-b')).toBe(false);
    } finally {
      await act(async () => root.unmount());
      dom.restore();
    }
  });

  test('opens the newly active project when the window changes', async () => {
    await useSessionCollapseStore.persist.rehydrate();
    const dom = installMinimalDom();
    const root: Root = createRoot(dom.container);
    const capture: HookCapture = { renderCount: 0 };
    const Harness = ({ activeProjectId }: { activeProjectId: string }) => {
      capture.renderCount += 1;
      const value = useSessionProjectViewState({
        projects: [{ id: 'project-a' }, { id: 'project-b' }],
        activeProjectId,
      });
      capture.state = value.state;
      capture.actions = value.actions;
      return null;
    };

    try {
      await act(async () => root.render(React.createElement(Harness, { activeProjectId: 'project-a' })));
      expect(capture.state?.collapsedProjects).toEqual(new Set(['project-b']));

      await act(async () => root.render(React.createElement(Harness, { activeProjectId: 'project-b' })));
      expect(capture.state?.collapsedProjects).toEqual(new Set(['project-a']));

      // Switching the window moves the open header with it: the project in use
      // stays open, the one left behind folds again.
      await act(async () => root.render(React.createElement(Harness, { activeProjectId: 'project-a' })));
      expect(capture.state?.collapsedProjects).toEqual(new Set(['project-b']));
    } finally {
      await act(async () => root.unmount());
      dom.restore();
    }
  });
});
