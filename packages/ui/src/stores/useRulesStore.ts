import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { emitConfigChange, scopeMatches, subscribeToConfigChanges } from "@/lib/configSync";
import { opencodeClient } from "@/lib/opencode/client";
import {
  dedupeRules,
  expandEntryPattern,
  resolveEntryDirectory,
  selectEntryFiles,
  toRuleInfo,
} from "@/lib/rules/resolveRules";
import type { RuleInfo } from "@/lib/rules/resolveRules";
import { useDirectoryStore } from "./useDirectoryStore";

/**
 * Rules shown in the `/` picker.
 *
 * A rule is not a command and not a skill: OpenCode injects it into the system
 * prompt through the config's `instructions` list, so it has no entry in the
 * agent's command registry. The single source of truth for what is active is
 * that same `instructions` list, read from the config of the directory the
 * session works in — never a second hand-written catalogue.
 *
 * The list holds file patterns (for example `~/.config/opencode/rules/*.md`),
 * so the files behind those patterns are what the picker needs. The directory
 * is listed (a listing works outside the workspace), but the files themselves
 * are not read: rule files live outside the workspace, where a read is denied,
 * and a readable name already sits in the file name.
 */

export type { RuleInfo, RuleScope } from "@/lib/rules/resolveRules";

interface RulesStore {
  selectedRuleName: string | null;
  /** Rules of the project the app is on. The picker reads this one. */
  rules: RuleInfo[];
  /** Every directory loaded so far, including the ambient one. */
  rulesByDirectory: Record<string, RuleInfo[]>;
  isLoading: boolean;

  setSelectedRule: (name: string | null) => void;
  loadRules: (directory?: string | null) => Promise<boolean>;
  getRuleByName: (name: string, directory?: string | null) => RuleInfo | undefined;
  resetForRuntimeSwitch: () => void;
}

const CONFIG_EVENT_SOURCE = "useRulesStore";
const RULES_LOAD_CACHE_TTL_MS = 5000;
const DEFAULT_RULES_CACHE_KEY = '__default__';
const rulesLastLoadedAt = new Map<string, number>();
const rulesLoadInFlight = new Map<string, Promise<boolean>>();
// Bumped on every runtime switch. Rules are discovered on the connected
// instance and cached by directory, so a load already in flight for the
// previous instance must not write into the new one.
let rulesGeneration = 0;

const getRulesCacheKey = (directory: string | null): string => directory?.trim() || DEFAULT_RULES_CACHE_KEY;

const getRequestDirectory = (): string | null => {
  try {
    const clientDir = opencodeClient.getDirectory();
    if (clientDir?.trim()) {
      return clientDir.trim();
    }
  } catch (err) {
    console.warn('[RulesStore] Error resolving config directory:', err);
  }

  return null;
};

const resolveDirectory = (directory?: string | null): string | null => {
  if (directory !== undefined) {
    const trimmed = directory?.trim();
    return trimmed ? trimmed : null;
  }
  return getRequestDirectory();
};

const EMPTY_RULES: RuleInfo[] = [];

/**
 * Expands one `instructions` entry into rule files. A missing entry is not an
 * error: the config legitimately points at files a project may not have.
 */
const resolveInstructionEntry = async (entry: string, home: string | null): Promise<RuleInfo[]> => {
  const directory = resolveEntryDirectory(entry, home);
  if (!directory) return [];

  let entries: Awaited<ReturnType<typeof opencodeClient.listLocalDirectory>>;
  try {
    entries = await opencodeClient.listLocalDirectory(directory);
  } catch {
    return [];
  }

  return selectEntryFiles(expandEntryPattern(entry, home), entries)
    .map((file) => toRuleInfo(file, 'user'));
};

export const useRulesStore = create<RulesStore>()(
  devtools(
    (set, get) => ({
      selectedRuleName: null,
      rules: [],
      rulesByDirectory: {},
      isLoading: false,

      resetForRuntimeSwitch: () => {
        rulesGeneration += 1;
        rulesLastLoadedAt.clear();
        rulesLoadInFlight.clear();
        set({ rules: [], rulesByDirectory: {}, isLoading: false });
      },

      setSelectedRule: (name: string | null) => {
        set({ selectedRuleName: name });
      },

      loadRules: async (requestedDirectory?: string | null) => {
        const directory = resolveDirectory(requestedDirectory);
        const cacheKey = getRulesCacheKey(directory);
        const isAmbient = cacheKey === getRulesCacheKey(getRequestDirectory());
        const now = Date.now();
        const loadedAt = rulesLastLoadedAt.get(cacheKey) ?? 0;
        const hasCachedRules = (get().rulesByDirectory[cacheKey] ?? (isAmbient ? get().rules : [])).length > 0;

        if (hasCachedRules && now - loadedAt < RULES_LOAD_CACHE_TTL_MS) {
          return true;
        }

        const inFlight = rulesLoadInFlight.get(cacheKey);
        if (inFlight) {
          return inFlight;
        }

        const generation = rulesGeneration;
        const request = (async () => {
          set({ isLoading: true });
          const previousRules = get().rulesByDirectory[cacheKey] ?? (isAmbient ? get().rules : []);
          let loadFailure: Error | null = null;

          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const config = await opencodeClient.getConfig(directory);
              const instructions = Array.isArray(config?.instructions) ? config.instructions : [];
              const home = useDirectoryStore.getState().homeDirectory || null;

              const resolved = await Promise.all(
                instructions
                  .filter((entry) => entry.trim().length > 0)
                  .map((entry) => resolveInstructionEntry(entry, home)),
              );

              // The same file can be named twice, or by both a user and a
              // project entry; it must count once.
              const activeRules = dedupeRules(resolved.flat());

              if (generation !== rulesGeneration) return false;
              set((state) => {
                const next: Partial<RulesStore> = {
                  rulesByDirectory: { ...state.rulesByDirectory, [cacheKey]: activeRules },
                  isLoading: false,
                };
                if (isAmbient) next.rules = activeRules;
                return next;
              });
              rulesLastLoadedAt.set(cacheKey, Date.now());
              return true;
            } catch (error) {
              loadFailure = error instanceof Error ? error : new Error(String(error));
              const waitMs = 200 * (attempt + 1);
              await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
          }

          console.error("Failed to load rules:", loadFailure);
          if (generation !== rulesGeneration) return false;
          set((state) => {
            const next: Partial<RulesStore> = {
              rulesByDirectory: { ...state.rulesByDirectory, [cacheKey]: previousRules },
              isLoading: false,
            };
            if (isAmbient) next.rules = previousRules;
            return next;
          });
          return false;
        })();

        rulesLoadInFlight.set(cacheKey, request);
        try {
          return await request;
        } finally {
          rulesLoadInFlight.delete(cacheKey);
        }
      },

      getRuleByName: (name: string, directory?: string | null) => {
        const rules = selectRulesForDirectory(get(), directory);
        return rules.find((rule) => rule.name === name);
      },
    }),
    { name: 'rules-store' },
  ),
);

/**
 * Rules of one project. Returns a stored array so components can select it
 * directly; an omitted directory means the project the app is on.
 */
export const selectRulesForDirectory = (
  state: Pick<RulesStore, 'rulesByDirectory'>,
  directory?: string | null,
): RuleInfo[] => {
  const cacheKey = getRulesCacheKey(resolveDirectory(directory));
  return state.rulesByDirectory[cacheKey] ?? EMPTY_RULES;
};

/**
 * Drops the freshness stamp of one directory (or every directory), so the next
 * `loadRules` re-reads the config instead of trusting the cache. Called after a
 * config change that decides which rules are active.
 */
export const invalidateRulesLoadCache = (directory: string | null = getRequestDirectory()): void => {
  rulesLastLoadedAt.delete(getRulesCacheKey(directory));
};

export async function refreshRulesAfterOpenCodeRestart(): Promise<void> {
  const store = useRulesStore.getState();
  invalidateRulesLoadCache();
  const loaded = await store.loadRules();
  if (loaded) {
    emitConfigChange("rules", { source: CONFIG_EVENT_SOURCE });
  }
}

let unsubscribeRulesConfigChanges: (() => void) | null = null;

if (!unsubscribeRulesConfigChanges) {
  unsubscribeRulesConfigChanges = subscribeToConfigChanges((event) => {
    if (event.source === CONFIG_EVENT_SOURCE) {
      return;
    }

    if (scopeMatches(event, "rules")) {
      invalidateRulesLoadCache();
      const { loadRules } = useRulesStore.getState();
      void loadRules();
    }
  });
}
