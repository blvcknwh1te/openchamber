import { describe, expect, test } from 'bun:test';
import {
  PROJECT_COLLAPSE_STORAGE_KEY,
  PROJECT_EXPAND_STORAGE_KEY,
  clearSessionCollapseState,
  readSessionCollapseState,
  writeSessionCollapseState,
  type WritableStorage,
} from './sessionCollapsePersistence';

const createStorage = (seed?: Record<string, string>) => {
  const values = new Map<string, string>(Object.entries(seed ?? {}));
  const storage: WritableStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return { storage, values };
};

describe('sessionCollapsePersistence', () => {
  test('writes the collapse list under the legacy key', () => {
    const { storage, values } = createStorage();

    writeSessionCollapseState(storage, { collapsedProjectIds: ['project-a'], expandedProjectIds: [] });

    expect(values.get(PROJECT_COLLAPSE_STORAGE_KEY)).toBe(JSON.stringify(['project-a']));
    // An empty expand list is the absence of a decision, not a stored value.
    expect(values.has(PROJECT_EXPAND_STORAGE_KEY)).toBe(false);
  });

  test('round-trips both lists', () => {
    const { storage } = createStorage();
    const state = { collapsedProjectIds: ['project-a'], expandedProjectIds: ['project-b'] };

    writeSessionCollapseState(storage, state);

    expect(readSessionCollapseState(storage)).toEqual(state);
  });

  test('clearing removes both keys', () => {
    const { storage, values } = createStorage();
    writeSessionCollapseState(storage, { collapsedProjectIds: ['project-a'], expandedProjectIds: ['project-b'] });

    clearSessionCollapseState(storage);

    expect(values.has(PROJECT_COLLAPSE_STORAGE_KEY)).toBe(false);
    expect(values.has(PROJECT_EXPAND_STORAGE_KEY)).toBe(false);
  });

  test('reads a collapse list written by an older release', () => {
    // The pre-store release wrote only this key, and so did `persistence.ts`.
    const { storage } = createStorage({ [PROJECT_COLLAPSE_STORAGE_KEY]: JSON.stringify(['project-x']) });

    expect(readSessionCollapseState(storage)).toEqual({
      collapsedProjectIds: ['project-x'],
      expandedProjectIds: [],
    });
  });

  test('treats missing, malformed, and wrongly-shaped data as empty', () => {
    const cases: Array<Record<string, string>> = [
      {},
      { [PROJECT_COLLAPSE_STORAGE_KEY]: '{malformed' },
      { [PROJECT_COLLAPSE_STORAGE_KEY]: '["project-a", 2]' },
      { [PROJECT_COLLAPSE_STORAGE_KEY]: '"project-a"' },
      { [PROJECT_EXPAND_STORAGE_KEY]: 'null' },
    ];

    for (const seed of cases) {
      const { storage } = createStorage(seed);
      expect(readSessionCollapseState(storage)).toEqual({ collapsedProjectIds: [], expandedProjectIds: [] });
    }
  });
});
