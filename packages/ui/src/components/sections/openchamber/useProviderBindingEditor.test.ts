import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, test } from 'bun:test';
import type { SourceControlAuthStatus, SourceControlBindingRead, SourceControlIdentity, SourceControlProviderBindingMutation } from '@/lib/api/types';
import { useProviderBindingEditor } from './useProviderBindingEditor';
import { repositoryBindingOwner, useRepositoryBinding } from '@/lib/source-control/repository-binding';

type EditorInput = Parameters<typeof useProviderBindingEditor>[0];
type Editor = ReturnType<typeof useProviderBindingEditor>;
const github = { provider: 'github', instance: 'github.com' } as const;
const gitlab = { provider: 'gitlab', instance: 'https://gitlab.com' } as const;
const original = { ...github, accountId: 'github#1', primaryRemote: 'origin' };
const sibling = { ...gitlab, accountId: 'gitlab#2', primaryRemote: 'mirror' };
const remote = (name: string, host: string) => ({ name,
  fetch: { displayUrl: `https://${host}/team/repo.git`, fingerprint: `${name}-fetch` },
  push: { displayUrl: `https://${host}/team/repo.git`, fingerprint: `${name}-push` },
});
const repository = { repositoryId: 'repo_one', configRevision: 'config_one', bare: false,
  remotes: [remote('origin', 'github.com'), remote('mirror', 'gitlab.com'), remote('upstream', 'gitlab.com')],
};
const bound: SourceControlBindingRead = { status: 'bound', repository, revision: 4, binding: {
  repositoryId: repository.repositoryId, configRevision: repository.configRevision, revision: 4, state: 'bound',
  providers: [original, sibling].map((provider, index) => ({ ...provider, readiness: 'ready', endpoint: repository.remotes[index].fetch })),
  remotes: [{ ...repository.remotes[0], mode: 'managed', credentialId: 'transport-grant', readiness: 'ready' }],
  auxiliary: [{ kind: 'lfs', mode: 'system', readiness: 'ready', endpoint: { displayUrl: 'https://example.com/lfs', fingerprint: 'lfs' } }],
} };
const connected = (identity: SourceControlIdentity = github): Extract<SourceControlAuthStatus, { status: 'connected' }> => {
  const user = { ...identity, id: '1', username: 'user' };
  return { ...identity, status: 'connected', connected: true, user,
    accounts: [{ id: `${identity.provider}#1`, credentialId: `${identity.provider}#1`, credentialRevision: 1,
      providerUserId: `${identity.instance}#1`, providerUserStatus: 'available', user, current: true, source: 'pat', status: 'valid' }],
  };
};

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

// The probe renders no DOM nodes. This implements only React root setup and event subscription.
const mount = async (overrides: Partial<EditorInput> = {}, initialBinding: SourceControlBindingRead | null = bound) => {
  class TestWindow extends EventTarget {
    HTMLIFrameElement = class {};
    __OPENCHAMBER_API_BASE_URL__ = 'https://runtime-a.example.com';
  }
  const runtimeWindow = new TestWindow();
  const document = Object.assign(new EventTarget(), { nodeType: 9, defaultView: runtimeWindow, activeElement: null });
  const container = Object.assign(new EventTarget(), {
    nodeType: 1, tagName: 'DIV', nodeName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
  });
  Object.defineProperty(container, 'ownerDocument', { value: document });
  const globals: Array<[string, PropertyDescriptor]> = [
    ['window', { value: runtimeWindow, configurable: true }],
    ['document', { value: document, configurable: true }],
    ['IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true }],
  ];
  const previous = globals.map(([key]) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, descriptor] of globals) Object.defineProperty(globalThis, key, descriptor);
  repositoryBindingOwner.reset();
  if (initialBinding) await repositoryBindingOwner.read(repositoryBindingOwner.scope(overrides.directory ?? '/repo'), {
    repositoryBinding: async () => initialBinding,
  });
  // SAFETY: The probe renders null, so React only uses the root setup members implemented above.
  const root = createRoot(container as Element);
  let editor: Editor | undefined;
  let observedBinding: ReturnType<typeof useRepositoryBinding> | undefined;
  const observedRevisions: number[] = [];
  const calls: SourceControlProviderBindingMutation[] = [];
  let reads = 0;
  let input: EditorInput = {
    directory: '/repo',
    sourceControl: {
      repositoryBinding: async () => { reads += 1; return bound; },
      repositoryProviderBindingMutate: async (mutation) => {
        calls.push(mutation);
        if (!bound.binding) throw new Error('Missing fixture binding');
        return { ...bound, revision: 5, binding: { ...bound.binding, revision: 5 } };
      },
    },
    identities: [github, gitlab],
    authEntry: (identity) => ({ hasChecked: true, status: connected(identity) }),
    operationFailed: 'Operation failed',
    ...overrides,
  };
  const Probe = () => {
    editor = useProviderBindingEditor(input);
    observedBinding = useRepositoryBinding(input.directory, input.sourceControl);
    const context = observedBinding.contexts[0];
    React.useEffect(() => { if (context) observedRevisions.push(context.bindingRevision); }, [context]);
    return null;
  };
  const render = () => act(() => { root.render(React.createElement(Probe)); });
  render();
  cleanups.push(() => {
    act(() => { root.unmount(); });
    repositoryBindingOwner.reset();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return {
    get editor() { if (!editor) throw new Error('Probe did not render'); return editor; },
    get observedBinding() { if (!observedBinding) throw new Error('Observer did not render'); return observedBinding; },
    observedRevisions,
    calls, get reads() { return reads; },
    rerender: (next: Partial<EditorInput>) => { input = { ...input, ...next }; render(); },
    switchRuntime: () => act(() => {
      runtimeWindow.__OPENCHAMBER_API_BASE_URL__ = 'https://runtime-b.example.com';
      runtimeWindow.dispatchEvent(new CustomEvent('openchamber:runtime-endpoint-changed'));
    }),
  };
};

describe('provider binding editor', () => {
  test('mounted editor and read consumer share deferred failure, retry and mutation publications', async () => {
    let reject: (error: Error) => void = () => { throw new Error('Deferred read not initialized'); };
    const response = new Promise<SourceControlBindingRead>((_resolve, fail) => { reject = fail; });
    let reads = 0;
    const next: SourceControlBindingRead = { ...bound, revision: 5, binding: { ...bound.binding, revision: 5 } };
    const view = await mount({ sourceControl: {
      repositoryBinding: () => { reads += 1; return reads === 1 ? response : Promise.resolve(bound); },
      repositoryProviderBindingMutate: async () => next,
    } }, null);
    expect(reads).toBe(1);
    expect(view.editor.isLoading).toBe(true);
    await act(async () => { reject(new Error('read failed')); await response.catch(() => {}); });
    expect(view.editor.isLoading).toBe(false);
    expect(view.editor.error).toBe('Operation failed');
    expect(view.observedBinding.status).toBe('error');
    for (let index = 0; index < 100; index += 1) view.rerender({ operationFailed: 'Operation failed' });
    expect(reads).toBe(1);
    await act(() => view.editor.retry());
    expect(reads).toBe(2);
    expect(view.editor.error).toBeNull();
    expect(view.observedRevisions).toEqual([4]);
    const previousAuthority = view.observedBinding.isCurrent;
    expect(previousAuthority()).toBe(true);
    await act(() => view.editor.saveBinding());
    expect(previousAuthority()).toBe(false);
    expect(view.observedBinding.isCurrent()).toBe(true);
    expect(view.observedBinding.read).toBe(next);
    expect(view.observedRevisions).toEqual([4, 5]);
    expect(reads).toBe(2);
  });

  test('changing the provider and primary remote replaces the originally edited association, not a sibling', async () => {
    const view = await mount();
    const option = view.editor.options.find((item) => item.remote.name === 'upstream');
    if (!option) throw new Error('Missing replacement option');
    act(() => view.editor.setSelectedKey(option.key));
    await act(() => view.editor.saveBinding());
    expect(view.calls).toEqual([{
      directory: '/repo', expectedRepositoryId: 'repo_one', expectedRevision: 4,
      operation: 'replace', target: original,
      provider: { ...gitlab, accountId: 'gitlab#1', primaryRemote: 'upstream' },
    }]);
    expect(view.observedRevisions).toEqual([4, 5]);
  });

  test('remove submits only the original provider target, even with a different unsaved selection', async () => {
    const view = await mount();
    act(() => view.editor.setSelectedKey(view.editor.options[2].key));
    await act(() => view.editor.removeBinding());
    expect(view.calls).toEqual([{
      directory: '/repo', expectedRepositoryId: 'repo_one', expectedRevision: 4, operation: 'remove', target: original,
    }]);
  });

  test('a transport-only binding uses explicit add and never sends transport or auxiliary fields', async () => {
    if (!bound.binding) throw new Error('Missing fixture binding');
    const view = await mount({}, { ...bound, binding: { ...bound.binding, providers: [] } });
    await act(() => view.editor.removeBinding());
    expect(view.calls).toHaveLength(0);
    await act(() => view.editor.saveBinding());
    expect(view.calls).toEqual([{
      directory: '/repo', expectedRepositoryId: 'repo_one', expectedRevision: 4, operation: 'add', provider: original,
    }]);
    expect(view.calls).toHaveLength(1);
  });

  for (const status of ['unreachable', 'temporarily-unavailable', 'unavailable'] as const) {
    test(`${status} inventories cannot offer retained valid accounts for selection`, async () => {
      const accounts = connected().accounts;
      const view = await mount({ authEntry: () => ({ hasChecked: true, status: { ...github, connected: false, status, accounts } }) });
      expect(view.editor.options).toEqual([]);
      expect(view.editor.selected).toBeNull();
      await act(() => view.editor.saveBinding());
      expect(view.calls).toEqual([]);
      await act(() => view.editor.removeBinding());
      expect(view.calls[0]?.operation).toBe('remove');
    });
  }

  test('unchecked inventories cannot make valid accounts selectable', async () => {
    const view = await mount({ authEntry: () => ({ hasChecked: false, status: connected() }) });
    expect(view.editor.options).toEqual([]);
  });

  test('a mutation conflict refreshes authority without retrying the mutation', async () => {
    let writes = 0;
    let reads = 0;
    const view = await mount({ sourceControl: {
      repositoryBinding: async () => { reads += 1; return bound; },
      repositoryProviderBindingMutate: async () => { writes += 1; throw new Error('Repair transport independently'); },
    } });
    await act(() => view.editor.saveBinding());
    expect(view.editor.error).toBe('Repair transport independently');
    expect(view.editor.bindingRead).toBe(bound);
    expect(view.editor.isSaving).toBe(false);
    expect(view.observedBinding.read).toBe(bound);
    expect(writes).toBe(1);
    expect(reads).toBe(1);
  });

  test('failed conflict reconciliation preserves the previous binding and original error', async () => {
    let writes = 0;
    const view = await mount({ sourceControl: {
      repositoryBinding: async () => { throw new Error('Read unavailable'); },
      repositoryProviderBindingMutate: async () => { writes += 1; throw new Error('Binding conflict'); },
    } });
    await act(() => view.editor.saveBinding());
    expect(view.editor.error).toBe('Binding conflict');
    expect(view.editor.bindingRead).toBe(bound);
    expect(view.editor.isSaving).toBe(false);
    expect(view.observedBinding.status).toBe('error');
    expect(writes).toBe(1);
  });

  for (const operation of ['saveBinding', 'removeBinding'] as const) {
    for (const scope of ['directory', 'runtime'] as const) {
      for (const outcome of ['success', 'failure'] as const) {
        test(`${operation} ignores ${outcome} after a ${scope} generation change`, async () => {
          let resolve: (value: SourceControlBindingRead) => void = () => { throw new Error('Promise not initialized'); };
          let reject: (error: Error) => void = () => { throw new Error('Promise not initialized'); };
          const promise = new Promise<SourceControlBindingRead>((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
          });
          const next: SourceControlBindingRead = { status: 'missing', repository: { ...repository, repositoryId: 'repo_two' }, revision: 0, binding: null };
          const view = await mount({ sourceControl: { repositoryBinding: async () => next, repositoryProviderBindingMutate: () => promise } });
          let completion: Promise<void> | undefined;
          act(() => { completion = view.editor[operation](); });
          expect(view.editor.isSaving).toBe(true);
          if (scope === 'directory') view.rerender({ directory: '/other' });
          else view.switchRuntime();
          await act(async () => {
            if (outcome === 'success') resolve(bound);
            else reject(new Error('old runtime error'));
            await completion;
          });
          expect(view.editor.bindingRead).toBe(next);
          expect(view.editor.error).toBeNull();
          expect(view.editor.isSaving).toBe(false);
          expect(view.observedBinding.read).toBe(next);
        });
      }
    }
  }
});
