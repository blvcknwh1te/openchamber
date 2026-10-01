import React from 'react';
import { useGlobalSyncStore } from '@/sync/global-sync-store';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import {
  buildSessionDirectoryKeys,
  resolveSessionProjects,
  type SessionProjectDisplayEntry,
} from './externalSessionProjects';

/**
 * The sidebar's project list, extended with projects the shared OpenCode
 * database knows and the local registry does not.
 *
 * VS Code keeps its registry in sync with the workspace folders, so its sidebar
 * would only ever show the folders currently open even though every session
 * lives in the same database. Web and desktop keep the registry as the single
 * authority, so the discovery stays behind `enabled`.
 *
 * A discovered project is only added while it owns at least one session; the
 * global sessions cache is the authority for that, and it is never treated as
 * empty while a fetch is still pending or has failed.
 */
export const useExternalSessionProjects = (
  registryProjects: SessionProjectDisplayEntry[],
  enabled: boolean,
): SessionProjectDisplayEntry[] => {
  const globalProjects = useGlobalSyncStore((state) => state.projects);
  const activeSessions = useGlobalSessionsStore((state) => state.activeSessions);
  const archivedSessions = useGlobalSessionsStore((state) => state.archivedSessions);

  const sessionDirectoryKeys = React.useMemo(
    () => buildSessionDirectoryKeys([...activeSessions, ...archivedSessions]),
    [activeSessions, archivedSessions],
  );

  return React.useMemo(
    () => resolveSessionProjects(registryProjects, globalProjects, sessionDirectoryKeys, enabled),
    [enabled, globalProjects, registryProjects, sessionDirectoryKeys],
  );
};
