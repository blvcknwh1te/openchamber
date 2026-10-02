import React from 'react';
import { updateDesktopSettings } from '@/lib/persistence';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { getDeferredSafeStorage } from '@/stores/utils/safeStorage';
import { z } from 'zod';
import { useGroupOrdering } from './useGroupOrdering';

const PROJECT_COLLAPSE_STORAGE_KEY = 'oc.sessions.projectCollapse';
// Set once the user collapses or expands something themselves. Without it an
// empty `oc.sessions.projectCollapse` cannot be told apart from "no choice yet",
// and the first-run default would come back over a deliberate "expand all".
const PROJECT_COLLAPSE_CHOSEN_STORAGE_KEY = 'oc.sessions.projectCollapseChosen';
const GROUP_ORDER_STORAGE_KEY = 'oc.sessions.groupOrder';
const GROUP_COLLAPSE_STORAGE_KEY = 'oc.sessions.groupCollapse';

type Project = { id: string };

type SessionProjectViewStateArgs = {
  isVSCode: boolean;
  projects: readonly Project[];
  /** Project of the open window, kept expanded by the first-run default. */
  activeProjectId?: string | null;
};

const parseStringSet = (raw: string | null): Set<string> => {
  if (!raw) return new Set();
  try {
    const parsed = z.array(z.string()).safeParse(JSON.parse(raw));
    return new Set(parsed.success ? parsed.data : []);
  } catch {
    return new Set();
  }
};

const setsEqual = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => (
  a.size === b.size && Array.from(a).every((value) => b.has(value))
);

const parseGroupOrder = (raw: string | null): Map<string, string[]> => {
  if (!raw) return new Map();
  try {
    const parsed = z.record(z.string(), z.array(z.string())).safeParse(JSON.parse(raw));
    if (!parsed.success) return new Map();
    const next = new Map<string, string[]>();
    for (const [projectId, order] of Object.entries(parsed.data)) {
      next.set(projectId, order);
    }
    return next;
  } catch {
    return new Map();
  }
};

export const useSessionProjectViewState = ({
  isVSCode,
  projects,
  activeProjectId = null,
}: SessionProjectViewStateArgs) => {
  const safeStorage = React.useMemo(() => getDeferredSafeStorage(), []);
  const collapseChosenRef = React.useRef<boolean | null>(null);
  if (collapseChosenRef.current === null) {
    collapseChosenRef.current = safeStorage.getItem(PROJECT_COLLAPSE_CHOSEN_STORAGE_KEY) === 'true';
  }
  const [collapsedProjects, setCollapsedProjects] = React.useState<Set<string>>(() => (
    parseStringSet(safeStorage.getItem(PROJECT_COLLAPSE_STORAGE_KEY))
  ));
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => (
    parseStringSet(safeStorage.getItem(GROUP_COLLAPSE_STORAGE_KEY))
  ));
  const [groupOrderByProject, setGroupOrderByProject] = React.useState<Map<string, string[]>>(() => (
    parseGroupOrder(safeStorage.getItem(GROUP_ORDER_STORAGE_KEY))
  ));
  const ignoreIntersectionUntil = React.useRef<number>(0);
  const groupCollapseDirty = React.useRef(false);
  const groupOrderDirty = React.useRef(false);
  const persistCollapsedProjectsTimer = React.useRef<number | null>(null);
  const pendingCollapsedProjects = React.useRef<Set<string> | null>(null);
  // The default is applied once per mount: projects arrive after the first
  // render, and a later change of the active project must not collapse the
  // project the user just opened.
  const defaultCollapseApplied = React.useRef(false);

  // Records that the collapse state is now the user's own choice, so neither the
  // first-run default nor a stale stored value can overwrite it.
  const markCollapseChosen = React.useCallback(() => {
    if (collapseChosenRef.current === true) return;
    collapseChosenRef.current = true;
    try {
      safeStorage.setItem(PROJECT_COLLAPSE_CHOSEN_STORAGE_KEY, 'true');
    } catch {
      // ignored
    }
  }, [safeStorage]);

  const flushCollapsedProjectsPersist = React.useCallback(() => {
    if (isVSCode) return;
    const collapsed = pendingCollapsedProjects.current;
    pendingCollapsedProjects.current = null;
    persistCollapsedProjectsTimer.current = null;
    if (!collapsed) return;

    const { projects: storedProjects } = useProjectsStore.getState();
    const updatedProjects = storedProjects.map((project) => ({
      ...project,
      sidebarCollapsed: collapsed.has(project.id),
    }));
    void updateDesktopSettings({ projects: updatedProjects }).catch(() => {});
  }, [isVSCode]);

  const scheduleCollapsedProjectsPersist = React.useCallback((collapsed: Set<string>) => {
    if (!globalThis.window || isVSCode) return;
    pendingCollapsedProjects.current = collapsed;
    if (persistCollapsedProjectsTimer.current !== null) {
      window.clearTimeout(persistCollapsedProjectsTimer.current);
    }
    persistCollapsedProjectsTimer.current = window.setTimeout(() => {
      flushCollapsedProjectsPersist();
    }, 700);
  }, [flushCollapsedProjectsPersist, isVSCode]);

  React.useEffect(() => {
    return () => {
      if (globalThis.window && persistCollapsedProjectsTimer.current !== null) {
        window.clearTimeout(persistCollapsedProjectsTimer.current);
      }
      persistCollapsedProjectsTimer.current = null;
      pendingCollapsedProjects.current = null;
    };
  }, []);

  // First run keeps the active project open and folds every other one: with a
  // session list spanning several projects the open one is what the user wants
  // to see, and a collapsed header still shows the project name. A user who
  // collapsed or expanded anything themselves keeps that choice, including
  // "expand all".
  React.useEffect(() => {
    if (defaultCollapseApplied.current || collapseChosenRef.current === true) return;
    if (projects.length === 0) return;

    defaultCollapseApplied.current = true;
    const next = new Set(
      projects.filter((project) => project.id !== activeProjectId).map((project) => project.id),
    );
    setCollapsedProjects((previous) => (setsEqual(previous, next) ? previous : next));
    try {
      safeStorage.setItem(PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // ignored
    }
    scheduleCollapsedProjectsPersist(next);
  }, [activeProjectId, projects, safeStorage, scheduleCollapsedProjectsPersist]);

  React.useEffect(() => {
    if (!groupOrderDirty.current) return;
    try {
      safeStorage.setItem(GROUP_ORDER_STORAGE_KEY, JSON.stringify(Object.fromEntries(groupOrderByProject.entries())));
    } catch {
      // ignored
    }
  }, [groupOrderByProject, safeStorage]);

  React.useEffect(() => {
    if (!groupCollapseDirty.current) return;
    try {
      safeStorage.setItem(GROUP_COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(collapsedGroups)));
    } catch {
      // ignored
    }
  }, [collapsedGroups, safeStorage]);

  const collapseAllProjects = React.useCallback(() => {
    markCollapseChosen();
    ignoreIntersectionUntil.current = Date.now() + 150;
    groupCollapseDirty.current = true;
    setCollapsedGroups(new Set());
    setCollapsedProjects(() => {
      const allIds = new Set(projects.map((project) => project.id));
      try {
        safeStorage.setItem(PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(allIds)));
      } catch {
        // ignored
      }
      scheduleCollapsedProjectsPersist(allIds);
      return allIds;
    });
  }, [markCollapseChosen, projects, safeStorage, scheduleCollapsedProjectsPersist]);

  const expandAllProjects = React.useCallback(() => {
    markCollapseChosen();
    ignoreIntersectionUntil.current = Date.now() + 150;
    groupCollapseDirty.current = true;
    setCollapsedGroups(new Set());
    setCollapsedProjects(() => {
      const empty = new Set<string>();
      try {
        safeStorage.setItem(PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify([]));
      } catch {
        // ignored
      }
      scheduleCollapsedProjectsPersist(empty);
      return empty;
    });
  }, [markCollapseChosen, safeStorage, scheduleCollapsedProjectsPersist]);

  // Collapsing or expanding a single project is a choice too, and it also pins
  // the state: a project the user just opened on purpose must survive a restart
  // even though the default would have folded it.
  const updateCollapsedProjects = React.useCallback<React.Dispatch<React.SetStateAction<Set<string>>>>((update) => {
    markCollapseChosen();
    setCollapsedProjects((previous) => {
      const next = typeof update === 'function' ? update(previous) : update;
      if (setsEqual(previous, next)) return previous;
      try {
        safeStorage.setItem(PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // ignored
      }
      scheduleCollapsedProjectsPersist(next);
      return next;
    });
  }, [markCollapseChosen, safeStorage, scheduleCollapsedProjectsPersist]);

  const toggleProject = React.useCallback((projectId: string) => {
    markCollapseChosen();
    ignoreIntersectionUntil.current = Date.now() + 150;
    setCollapsedProjects((previous) => {
      const next = new Set(previous);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      try {
        safeStorage.setItem(PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // ignored
      }
      scheduleCollapsedProjectsPersist(next);
      return next;
    });
  }, [markCollapseChosen, safeStorage, scheduleCollapsedProjectsPersist]);

  const toggleGroup = React.useCallback((key: string) => {
    groupCollapseDirty.current = true;
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const updateGroupOrderByProject = React.useCallback<React.Dispatch<React.SetStateAction<Map<string, string[]>>>>((update) => {
    groupOrderDirty.current = true;
    setGroupOrderByProject(update);
  }, []);

  const { getOrderedGroups } = useGroupOrdering(groupOrderByProject);
  const state = React.useMemo(() => ({
    collapsedProjects,
    collapsedGroups,
    groupOrderByProject,
  }), [collapsedGroups, collapsedProjects, groupOrderByProject]);
  const actions = React.useMemo(() => ({
    setCollapsedProjects: updateCollapsedProjects,
    toggleProject,
    collapseAllProjects,
    expandAllProjects,
    scheduleCollapsedProjectsPersist,
    setCollapsedGroups,
    toggleGroup,
    setGroupOrderByProject: updateGroupOrderByProject,
    getOrderedGroups,
  }), [collapseAllProjects, expandAllProjects, getOrderedGroups, scheduleCollapsedProjectsPersist, toggleGroup, toggleProject, updateCollapsedProjects, updateGroupOrderByProject]);

  return { state, actions };
};
