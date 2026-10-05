import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { getDeferredSafeStorage } from './utils/safeStorage';
import {
  clearSessionCollapseState,
  readSessionCollapseState,
  writeSessionCollapseState,
} from './sessionCollapsePersistence';

type SessionCollapseState = {
  /** Projects the user folded by hand. */
  collapsedProjectIds: string[];
  /** Projects the user unfolded by hand, which stay open even when inactive. */
  expandedProjectIds: string[];
  /**
   * Every project id currently rendered. Registered by the sidebar so
   * `collapseAll` reaches all projects without reading the sidebar's own list.
   */
  knownProjectIds: string[];
};

type SessionCollapseActions = {
  registerKnownProjectIds: (ids: string[]) => void;
  setProjectCollapsed: (projectId: string, collapsed: boolean) => void;
  collapseAll: () => void;
  expandAll: () => void;
};

type SessionCollapseStore = SessionCollapseState & SessionCollapseActions;

const sameStringList = (a: readonly string[], b: readonly string[]): boolean => (
  a.length === b.length && a.every((value, index) => value === b[index])
);

/** Remove a project from one list and add it to the other, keeping them disjoint. */
const moveProject = (collapsed: string[], expanded: string[], projectId: string, toCollapsed: boolean) => ({
  collapsedProjectIds: toCollapsed
    ? [...new Set([...collapsed, projectId])]
    : collapsed.filter((id) => id !== projectId),
  expandedProjectIds: toCollapsed
    ? expanded.filter((id) => id !== projectId)
    : [...new Set([...expanded, projectId])],
});

/**
 * Persists through the shared storage adapter, leaving the payload format to
 * `sessionCollapsePersistence`. `knownProjectIds` is registration state and is
 * never persisted.
 */
const createCollapseStorage = (): PersistStorage<SessionCollapseState> => {
  const storage = getDeferredSafeStorage();

  return {
    // Always return a value (never null) so an explicit `persist.rehydrate()`
    // deterministically resets the collapse fields to what is stored. `merge`
    // below keeps the live registration list.
    getItem: (): StorageValue<SessionCollapseState> => ({
      state: { ...readSessionCollapseState(storage), knownProjectIds: [] },
      version: 1,
    }),
    setItem: (_name, value) => {
      try {
        writeSessionCollapseState(storage, value.state);
      } catch {
        // ignored
      }
    },
    removeItem: () => {
      try {
        clearSessionCollapseState(storage);
      } catch {
        // ignored
      }
    },
  };
};

export const useSessionCollapseStore = create<SessionCollapseStore>()(
  persist(
    (set) => ({
      collapsedProjectIds: [],
      expandedProjectIds: [],
      knownProjectIds: [],

      registerKnownProjectIds: (ids) => set((state) => {
        const next = Array.from(new Set(ids));
        return sameStringList(state.knownProjectIds, next)
          ? state
          : { knownProjectIds: next };
      }),

      setProjectCollapsed: (projectId, collapsed) => set((state) => {
        const isCollapsed = state.collapsedProjectIds.includes(projectId);
        const isExpanded = state.expandedProjectIds.includes(projectId);
        const unchanged = collapsed ? isCollapsed && !isExpanded : !isCollapsed && isExpanded;
        if (unchanged) return state;
        return moveProject(state.collapsedProjectIds, state.expandedProjectIds, projectId, collapsed);
      }),

      // Both "all" actions are absolute: folding everything must not leave an
      // earlier hand-opened project unfolded, and unfolding everything must not
      // leave an earlier hand-folded one folded.
      collapseAll: () => set((state) => ({
        collapsedProjectIds: [...new Set([...state.collapsedProjectIds, ...state.knownProjectIds])],
        expandedProjectIds: [],
      })),

      expandAll: () => set((state) => ({
        collapsedProjectIds: [],
        expandedProjectIds: [...new Set([...state.expandedProjectIds, ...state.knownProjectIds])],
      })),
    }),
    {
      name: 'session-project-collapse',
      version: 1,
      storage: createCollapseStorage(),
      partialize: (state) => ({
        collapsedProjectIds: state.collapsedProjectIds,
        expandedProjectIds: state.expandedProjectIds,
        knownProjectIds: [],
      }),
      // `knownProjectIds` is registration state the sidebar republishes on
      // mount, so a hydration must not clear the currently registered list.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<SessionCollapseState>),
        knownProjectIds: current.knownProjectIds,
      }),
    },
  ),
);
