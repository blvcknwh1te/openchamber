import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionCollapseStore } from '@/stores/useSessionCollapseStore';

// The compact sidebar hides its own header, so its collapse-all / expand-all
// controls render here instead, next to the archive actions. They drive the
// shared store the project list reads from, and stay hidden until the sidebar
// has registered at least one project.
export function VSCodeProjectCollapseControls(): React.ReactNode {
  const { t } = useI18n();
  const knownProjectIds = useSessionCollapseStore((state) => state.knownProjectIds);
  const collapseAll = useSessionCollapseStore((state) => state.collapseAll);
  const expandAll = useSessionCollapseStore((state) => state.expandAll);
  const setProjectCollapsed = useSessionCollapseStore((state) => state.setProjectCollapsed);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);

  if (knownProjectIds.length === 0) {
    return null;
  }

  // Folding every header would hide the sessions of the project in use, so the
  // active one stays open, exactly like the sidebar's own collapse-all.
  const handleCollapseAll = () => {
    collapseAll();
    if (activeProjectId) setProjectCollapsed(activeProjectId, false);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleCollapseAll}
        className="inline-flex h-8 w-8 items-center justify-center p-2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={t('sessions.sidebar.header.displayMode.collapseAll')}
        title={t('sessions.sidebar.header.displayMode.collapseAll')}
      >
        <Icon name="contract-up-down" className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={expandAll}
        className="inline-flex h-8 w-8 items-center justify-center p-2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={t('sessions.sidebar.header.displayMode.expandAll')}
        title={t('sessions.sidebar.header.displayMode.expandAll')}
      >
        <Icon name="expand-up-down" className="h-5 w-5" />
      </button>
    </>
  );
}
