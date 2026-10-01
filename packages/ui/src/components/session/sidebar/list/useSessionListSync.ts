import React from 'react';
import { subscribeOpenchamberEvents } from '@/lib/openchamberEvents';
import { refreshGlobalSessions, refreshGlobalSessionsForDirectories, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useChildStoreManager } from '@/sync/sync-context';
import { getAllSyncSessions } from '@/sync/sync-refs';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { buildSessionBootstrapDemands } from './sessionBootstrapDemands';
import { buildKnownSessionDirectories } from './sessionListDirectories';
import { useExternalSessionProjects } from './useExternalSessionProjects';
import { useAuthoritativeSessionCleanup } from './useAuthoritativeSessionCleanup';
import { normalizePath } from '../utils';

const EMPTY_WORKTREES_BY_PROJECT = new Map();

type UseSessionListSyncOptions = {
  isVSCode: boolean;
};

export const useSessionListSync = ({
  isVSCode,
}: UseSessionListSyncOptions) => {
  const childStores = useChildStoreManager();
  const projects = useProjectsStore((state) => state.projects);
  const displayProjects = useExternalSessionProjects(projects, isVSCode);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const currentSessionDirectory = useSessionUIStore((state) => state.currentSessionDirectory);
  const availableWorktreesByProject = useSessionUIStore((state) => isVSCode ? EMPTY_WORKTREES_BY_PROJECT : state.availableWorktreesByProject);
  // Background bootstrap demand stays on the registry: a discovered directory's
  // sessions already come from the global cache, and scheduling a full directory
  // bootstrap for every repository in a large database would trade a visible
  // list for unbounded background work.
  const knownDirectories = React.useMemo(
    () => buildKnownSessionDirectories(projects, availableWorktreesByProject, { includeWorktrees: !isVSCode }),
    [availableWorktreesByProject, isVSCode, projects],
  );
  // Everything the sidebar can render, discovered directories included: their
  // sessions need the same authoritative refresh to become addressable.
  const displayDirectories = React.useMemo(
    () => buildKnownSessionDirectories(displayProjects, availableWorktreesByProject, { includeWorktrees: !isVSCode }),
    [availableWorktreesByProject, displayProjects, isVSCode],
  );
  const globalActiveSessions = useGlobalSessionsStore((state) => state.activeSessions);
  const archivedSessions = useGlobalSessionsStore((state) => state.archivedSessions);
  const hasAuthoritativeGlobalSessions = useGlobalSessionsStore((state) => state.status === 'ready');
  const bootstrapDemandOwner = `session-list-sync:${React.useId()}`;

  React.useEffect(() => {
    childStores.setBootstrapDemand(bootstrapDemandOwner, buildSessionBootstrapDemands({
      knownDirectories,
      activeProjectDirectory: normalizePath(projects.find((project) => project.id === activeProjectId)?.path ?? null),
      activeProjectId,
      collapsedProjects: new Set(),
      collapsedGroups: new Set(),
      currentDirectory,
      currentSessionDirectory,
    }));
    return () => childStores.clearBootstrapDemand(bootstrapDemandOwner);
  }, [activeProjectId, bootstrapDemandOwner, childStores, currentDirectory, currentSessionDirectory, knownDirectories, projects]);

  const knownProjectSessionDirectoriesRef = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    const directories = new Set(displayDirectories);
    const previous = knownProjectSessionDirectoriesRef.current;
    knownProjectSessionDirectoriesRef.current = directories;
    const added = previous ? [...directories].filter((directory) => !previous.has(directory)) : isVSCode ? [...directories] : [];
    if (added.length) void refreshGlobalSessionsForDirectories(added, getAllSyncSessions());
  }, [displayDirectories, isVSCode]);

  React.useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let refreshAll = false;
    const directories = new Set<string>();
    const unsubscribe = subscribeOpenchamberEvents((event) => {
      if (event.type === 'scheduled-task-ran') refreshAll = true;
      else if (event.type === 'session-created') directories.add(event.directory);
      else return;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        timeout = null;
        if (refreshAll) {
          refreshAll = false;
          directories.clear();
          void refreshGlobalSessions(getAllSyncSessions());
          return;
        }
        const requested = [...directories];
        directories.clear();
        if (requested.length) void refreshGlobalSessionsForDirectories(requested, getAllSyncSessions());
      }, 500);
    });
    return () => {
      if (timeout) clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  const cleanupSessions = React.useMemo(
    () => [...globalActiveSessions, ...archivedSessions],
    [archivedSessions, globalActiveSessions],
  );
  useAuthoritativeSessionCleanup({
    enabled: true,
    hasAuthoritativeGlobalSessions,
    sessions: cleanupSessions,
  });
};
