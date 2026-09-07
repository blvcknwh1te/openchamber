import React from 'react';
import { useUIStore } from '@/stores/useUIStore';

/** Opens the Settings dialog on the Git page, where provider accounts and repository bindings live. */
export const useOpenSourceControlSettings = (): (() => void) => {
  const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen);
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);
  return React.useCallback(() => {
    setSettingsPage('git');
    setSettingsDialogOpen(true);
  }, [setSettingsDialogOpen, setSettingsPage]);
};
