import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { z } from 'zod';
import { getDeferredSafeStorage } from './utils/safeStorage';

// The web/desktop sidebar used to keep the collapsed-project set in local
// component state, so the compact VS Code header could not reach it. Both
// surfaces now share this store. The two persisted keys keep their historical
// names and value shapes byte for byte (a bare JSON string array plus a
// `'true'` marker), so a user's existing collapse choice survives the update.
export const PROJECT_COLLAPSE_STORAGE_KEY = 'oc.sessions.projectCollapse';
// Set once the user collapses or expands something themselves. Without it an
// empty `oc.sessions.projectCollapse` cannot be told apart from "no choice yet",
// and the first-run default would come back over a deliberate "expand all".
export const PROJECT_COLLAPSE_CHOSEN_STORAGE_KEY = 'oc.sessions.projectCollapseChosen';

type SessionCollapseState = {
  collapsedProjectIds: string[];
  collapseChosen: boolean;
  /**
   * Every project id currently rendered. Registered by the sidebar so
   * `collapseAll` reaches all projects without reading the sidebar's list.
   */
  knownProjectIds: string[];
};

type SessionCollapseActions = {
  setCollapsedProjectIds: (ids: string[]) => void;
  markCollapseChosen: () => void;
  registerKnownProjectIds: (ids: string[]) => void;
  collapseAll: () => void;
  expandAll: () => void;
};

type SessionCollapseStore = SessionCollapseState & SessionCollapseActions;

const parseCollapsedIds = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = z.array(z.string()).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
};

const sameStringList = (a: readonly string[], b: readonly string[]): boolean => (
  a.length === b.length && a.every((value, index) => value === b[index])
);

const sameStringSet = (a: readonly string[], b: readonly string[]): boolean => {
  const setB = new Set(b);
  return a.length === setB.size && a.every((value) => setB.has(value));
};

/**
 * Persists to the legacy twin keys instead of a single JSON blob, because the
 * store's value shape (bare array + marker) is already written by an older
 * release and by `persistence.ts`. `collapseAll`/`expandAll` and the derived
 * set are not persisted.
 */
const createCollapseStorage = (): PersistStorage<SessionCollapseState> => {
  const storage = getDeferredSafeStorage();

  const read = (): StorageValue<SessionCollapseState> => {
    const rawCollapsed = storage.getItem(PROJECT_COLLAPSE_STORAGE_KEY);
    const rawChosen = storage.getItem(PROJECT_COLLAPSE_CHOSEN_STORAGE_KEY);
    // Always return a value (never null) so an explicit `persist.rehydrate()`
    // deterministically resets the collapse fields to what is stored. The
    // `knownProjectIds` list is registration state, not persisted, and `merge`
    // below keeps the live list.
    return {
      state: {
        collapsedProjectIds: parseCollapsedIds(rawCollapsed),
        collapseChosen: rawChosen === 'true',
        knownProjectIds: [],
      },
      version: 1,
    };
  };

  return {
    getItem: () => read(),
    setItem: (_name, value) => {
      try {
        storage.setItem(
          PROJECT_COLLAPSE_STORAGE_KEY,
          JSON.stringify(value.state.collapsedProjectIds),
        );
        if (value.state.collapseChosen) {
          storage.setItem(PROJECT_COLLAPSE_CHOSEN_STORAGE_KEY, 'true');
        } else {
          storage.removeItem(PROJECT_COLLAPSE_CHOSEN_STORAGE_KEY);
        }
      } catch {
        // ignored
      }
    },
    removeItem: () => {
      try {
        storage.removeItem(PROJECT_COLLAPSE_STORAGE_KEY);
        storage.removeItem(PROJECT_COLLAPSE_CHOSEN_STORAGE_KEY);
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
      collapseChosen: false,
      knownProjectIds: [],

      setCollapsedProjectIds: (ids) => set((state) => {
        const next = Array.from(new Set(ids));
        return sameStringSet(state.collapsedProjectIds, next)
          ? state
          : { collapsedProjectIds: next };
      }),

      markCollapseChosen: () => set((state) => (
        state.collapseChosen ? state : { collapseChosen: true }
      )),

      registerKnownProjectIds: (ids) => set((state) => {
        const next = Array.from(new Set(ids));
        return sameStringList(state.knownProjectIds, next)
          ? state
          : { knownProjectIds: next };
      }),

      collapseAll: () => set((state) => ({
        collapsedProjectIds: [...state.knownProjectIds],
        collapseChosen: true,
      })),

      expandAll: () => set({
        collapsedProjectIds: [],
        collapseChosen: true,
      }),
    }),
    {
      name: 'session-project-collapse',
      version: 1,
      storage: createCollapseStorage(),
      partialize: (state) => ({
        collapsedProjectIds: state.collapsedProjectIds,
        collapseChosen: state.collapseChosen,
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
