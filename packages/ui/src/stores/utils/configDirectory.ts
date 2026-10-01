import { opencodeClient } from '@/lib/opencode/client';
import { useProjectsStore } from '@/stores/useProjectsStore';

/**
 * Single source of truth for the ambient configuration directory.
 *
 * The session directory (the directory the OpenCode client is on) takes
 * priority over the active workspace project: a settings panel can be opened
 * for a session whose project is not the open workspace, and it must read that
 * session's config. The active project is only a fallback for a caller that
 * runs before the client has a directory.
 */
export const resolveAmbientConfigDirectory = (): string | null => {
  try {
    const clientDir = opencodeClient.getDirectory();
    if (clientDir?.trim()) {
      return clientDir.trim();
    }

    const activeProject = useProjectsStore.getState().getActiveProject?.();
    if (activeProject?.path?.trim()) {
      return activeProject.path.trim();
    }
  } catch (err) {
    console.warn('[ConfigDirectory] Error resolving config directory:', err);
  }

  return null;
};
