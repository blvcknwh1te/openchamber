import React from 'react';
import { useSessionCollapseStore } from '@/stores/useSessionCollapseStore';
import { getDeferredSafeStorage } from '@/stores/utils/safeStorage';
import { z } from 'zod';
import { useGroupOrdering } from './useGroupOrdering';

const GROUP_ORDER_STORAGE_KEY = 'oc.sessions.groupOrder';
const GROUP_COLLAPSE_STORAGE_KEY = 'oc.sessions.groupCollapse';

type Project = { id: string };

type SessionProjectViewStateArgs = {
  projects: readonly Project[];
  /** Project of the open window, kept expanded by the default. */
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

/**
 * Resolves which project headers are folded.
 *
 * This is a derivation, not a state machine: the stored sets say what the user
 * decided, and everything else follows from them on every render. A project the
 * user never touched is folded unless it is the one being worked in, so a list
 * spanning several projects opens on the active one and stays that way across
 * restarts. There is deliberately no "the user has made a choice" marker: a
 * single marker could only be set, never cleared, so one expand-all click used
 * to disable the default for good.
 *
 * An explicit expand beats an explicit collapse for the same project, which
 * keeps the two stored sets from disagreeing after an action that touches both.
 */
const resolveCollapsedProjects = (
  projects: readonly Project[],
  activeProjectId: string | null,
  collapsedProjectIds: readonly string[],
  expandedProjectIds: readonly string[],
): Set<string> => {
  const chosenCollapsed = new Set(collapsedProjectIds);
  const chosenExpanded = new Set(expandedProjectIds);
  const collapsed = new Set<string>();
  for (const project of projects) {
    if (chosenExpanded.has(project.id)) continue;
    if (chosenCollapsed.has(project.id) || project.id !== activeProjectId) collapsed.add(project.id);
  }
  return collapsed;
};

export const useSessionProjectViewState = ({
  projects,
  activeProjectId = null,
}: SessionProjectViewStateArgs) => {
  const safeStorage = React.useMemo(() => getDeferredSafeStorage(), []);
  // Collapsed projects live in a shared store so the VS Code header can drive
  // the same state as the sidebar.
  const collapsedProjectIds = useSessionCollapseStore((store) => store.collapsedProjectIds);
  const expandedProjectIds = useSessionCollapseStore((store) => store.expandedProjectIds);
  const setProjectCollapsedInStore = useSessionCollapseStore((store) => store.setProjectCollapsed);
  const registerKnownProjectIds = useSessionCollapseStore((store) => store.registerKnownProjectIds);
  const collapseAllInStore = useSessionCollapseStore((store) => store.collapseAll);
  const expandAllInStore = useSessionCollapseStore((store) => store.expandAll);
  const collapsedProjects = React.useMemo(
    () => resolveCollapsedProjects(projects, activeProjectId, collapsedProjectIds, expandedProjectIds),
    [activeProjectId, collapsedProjectIds, expandedProjectIds, projects],
  );
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => (
    parseStringSet(safeStorage.getItem(GROUP_COLLAPSE_STORAGE_KEY))
  ));
  const [groupOrderByProject, setGroupOrderByProject] = React.useState<Map<string, string[]>>(() => (
    parseGroupOrder(safeStorage.getItem(GROUP_ORDER_STORAGE_KEY))
  ));
  const ignoreIntersectionUntil = React.useRef<number>(0);
  const groupCollapseDirty = React.useRef(false);
  const groupOrderDirty = React.useRef(false);

  // Publishes the rendered project list so `collapseAll` from the VS Code
  // header reaches every project without reading the sidebar's own list.
  React.useEffect(() => {
    registerKnownProjectIds(projects.map((project) => project.id));
  }, [projects, registerKnownProjectIds]);

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

  // Folding everything means everything except the project in use: a folded
  // active project would hide the sessions the user is looking at.
  const collapseAllProjects = React.useCallback(() => {
    ignoreIntersectionUntil.current = Date.now() + 150;
    groupCollapseDirty.current = true;
    setCollapsedGroups(new Set());
    registerKnownProjectIds(projects.map((project) => project.id));
    collapseAllInStore();
    if (activeProjectId) setProjectCollapsedInStore(activeProjectId, false);
  }, [activeProjectId, collapseAllInStore, projects, registerKnownProjectIds, setProjectCollapsedInStore]);

  const expandAllProjects = React.useCallback(() => {
    ignoreIntersectionUntil.current = Date.now() + 150;
    groupCollapseDirty.current = true;
    setCollapsedGroups(new Set());
    registerKnownProjectIds(projects.map((project) => project.id));
    expandAllInStore();
  }, [expandAllInStore, projects, registerKnownProjectIds]);

  // Opening the project being worked in must survive a restart, so toggling the
  // active project records an expand rather than a collapse.
  const toggleProject = React.useCallback((projectId: string) => {
    ignoreIntersectionUntil.current = Date.now() + 150;
    if (projectId === activeProjectId) {
      setProjectCollapsedInStore(projectId, false);
      return;
    }
    // A project folded by the default carries no entry in either set, so the
    // next state has to come from what is rendered, not from the stored list.
    setProjectCollapsedInStore(projectId, !collapsedProjects.has(projectId));
  }, [activeProjectId, collapsedProjects, setProjectCollapsedInStore]);

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
    toggleProject,
    collapseAllProjects,
    expandAllProjects,
    setCollapsedGroups,
    toggleGroup,
    setGroupOrderByProject: updateGroupOrderByProject,
    getOrderedGroups,
  }), [collapseAllProjects, expandAllProjects, getOrderedGroups, toggleGroup, toggleProject, updateGroupOrderByProject]);

  return { state, actions };
};
