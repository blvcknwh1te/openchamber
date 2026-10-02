import { beforeEach, describe, expect, mock, test } from 'bun:test';

const storage = new Map<string, string>();

const safeStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
  key: (index: number) => Array.from(storage.keys())[index] ?? null,
  get length() {
    return storage.size;
  },
} as Storage;

mock.module('./utils/safeStorage', () => ({
  getDeferredSafeStorage: () => safeStorage,
  getSafeStorage: () => safeStorage,
}));

const {
  PROJECT_COLLAPSE_STORAGE_KEY,
  PROJECT_COLLAPSE_CHOSEN_STORAGE_KEY,
  useSessionCollapseStore,
} = await import('./useSessionCollapseStore');

const resetStore = () => {
  useSessionCollapseStore.setState({
    collapsedProjectIds: [],
    collapseChosen: false,
    knownProjectIds: [],
  });
};

describe('useSessionCollapseStore', () => {
  beforeEach(() => {
    storage.clear();
    resetStore();
  });

  test('collapseAll collapses every registered project and marks the choice', () => {
    const store = useSessionCollapseStore.getState();
    store.registerKnownProjectIds(['project-a', 'project-b']);
    store.collapseAll();

    expect(useSessionCollapseStore.getState().collapsedProjectIds).toEqual(['project-a', 'project-b']);
    expect(useSessionCollapseStore.getState().collapseChosen).toBe(true);
  });

  test('expandAll clears the collapsed set and marks the choice', () => {
    const store = useSessionCollapseStore.getState();
    store.registerKnownProjectIds(['project-a']);
    store.collapseAll();
    store.expandAll();

    expect(useSessionCollapseStore.getState().collapsedProjectIds).toEqual([]);
    expect(useSessionCollapseStore.getState().collapseChosen).toBe(true);
  });

  test('setCollapsedProjectIds dedupes and does not persist knownProjectIds', () => {
    useSessionCollapseStore.getState().registerKnownProjectIds(['project-a']);
    useSessionCollapseStore.getState().setCollapsedProjectIds(['project-a', 'project-a']);
    expect(useSessionCollapseStore.getState().collapsedProjectIds).toEqual(['project-a']);
    expect(JSON.parse(storage.get(PROJECT_COLLAPSE_STORAGE_KEY) ?? 'null')).toEqual(['project-a']);
  });

  test('reads collapse state stored under the legacy keys', async () => {
    // Set the live registration state first: a `setState` persists the current
    // collapse fields, so storage is seeded after it and before rehydrating.
    useSessionCollapseStore.setState({ knownProjectIds: ['keep-me'] });
    storage.set(PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify(['project-x']));
    storage.set(PROJECT_COLLAPSE_CHOSEN_STORAGE_KEY, 'true');

    await useSessionCollapseStore.persist.rehydrate();

    const state = useSessionCollapseStore.getState();
    expect(state.collapsedProjectIds).toEqual(['project-x']);
    expect(state.collapseChosen).toBe(true);
    // Registration state is live, not persisted: hydration keeps the list.
    expect(state.knownProjectIds).toEqual(['keep-me']);
  });

  test('writes the legacy collapse keys back on change', () => {
    useSessionCollapseStore.getState().setCollapsedProjectIds(['project-a']);
    expect(storage.get(PROJECT_COLLAPSE_STORAGE_KEY)).toBe(JSON.stringify(['project-a']));

    useSessionCollapseStore.getState().markCollapseChosen();
    expect(storage.get(PROJECT_COLLAPSE_CHOSEN_STORAGE_KEY)).toBe('true');

    useSessionCollapseStore.getState().expandAll();
    expect(storage.get(PROJECT_COLLAPSE_STORAGE_KEY)).toBe('[]');
  });

  test('treats malformed stored data as empty', async () => {
    storage.set(PROJECT_COLLAPSE_STORAGE_KEY, '{malformed');
    await useSessionCollapseStore.persist.rehydrate();

    expect(useSessionCollapseStore.getState().collapsedProjectIds).toEqual([]);
    expect(useSessionCollapseStore.getState().collapseChosen).toBe(false);
  });
});
