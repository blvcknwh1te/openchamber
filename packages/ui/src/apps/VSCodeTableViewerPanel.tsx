import React from 'react';
import { TableViewerView } from '@/components/views/TableViewerView';
import type { RuntimeAPIs } from '@/lib/api/types';
import { VSCodePanelShell } from './VSCodePanelShell';

/**
 * Editor-tab panel that renders the markdown table handed over by the extension
 * host. The table fills the whole panel: it is fitted on open, then panned and
 * zoomed in place. It owns no session, so it mounts none of the chat effects.
 */
export function VSCodeTableViewerPanel({ apis }: { apis: RuntimeAPIs }) {
  const markdown = window.__OPENCHAMBER_TABLE_MARKDOWN__ ?? null;

  return (
    <VSCodePanelShell apis={apis}>
      <TableViewerView markdown={markdown} />
    </VSCodePanelShell>
  );
}
