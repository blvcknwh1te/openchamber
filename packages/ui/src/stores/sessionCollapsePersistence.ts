/**
 * Storage format for the sidebar's project collapse state.
 *
 * Kept in its own module because the format is a compatibility contract, not a
 * store detail: an older release and `persistence.ts` both wrote the same legacy
 * key, so the shape has to be readable and writable on its own, without a store
 * instance and without mocking the shared storage module.
 */
import { z } from 'zod';

/** Legacy key: a bare JSON array of the projects the user folded. */
export const PROJECT_COLLAPSE_STORAGE_KEY = 'oc.sessions.projectCollapse';
/**
 * The explicit counterpart: projects the user unfolded by hand. A project is
 * folded by default until the user unfolds it, so "keep this one open" cannot be
 * expressed by the collapse list alone.
 */
export const PROJECT_EXPAND_STORAGE_KEY = 'oc.sessions.projectExpand';

type SessionCollapsePersisted = {
  collapsedProjectIds: string[];
  expandedProjectIds: string[];
};

type ReadableStorage = Pick<Storage, 'getItem'>;
export type WritableStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const parseIdList = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = z.array(z.string()).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
};

export const readSessionCollapseState = (storage: ReadableStorage): SessionCollapsePersisted => ({
  collapsedProjectIds: parseIdList(storage.getItem(PROJECT_COLLAPSE_STORAGE_KEY)),
  expandedProjectIds: parseIdList(storage.getItem(PROJECT_EXPAND_STORAGE_KEY)),
});

const writeIdList = (storage: WritableStorage, key: string, ids: readonly string[]) => {
  // An empty list is the absence of a decision, not a decision for nothing.
  if (ids.length > 0) storage.setItem(key, JSON.stringify(ids));
  else storage.removeItem(key);
};

export const writeSessionCollapseState = (
  storage: WritableStorage,
  state: SessionCollapsePersisted,
): void => {
  writeIdList(storage, PROJECT_COLLAPSE_STORAGE_KEY, state.collapsedProjectIds);
  writeIdList(storage, PROJECT_EXPAND_STORAGE_KEY, state.expandedProjectIds);
};

export const clearSessionCollapseState = (storage: WritableStorage): void => {
  storage.removeItem(PROJECT_COLLAPSE_STORAGE_KEY);
  storage.removeItem(PROJECT_EXPAND_STORAGE_KEY);
};
