import React, { type ReactNode } from 'react';
import { RuntimeAPIProvider } from '@/contexts/RuntimeAPIProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import type { RuntimeAPIs } from '@/lib/api/types';

/**
 * Shared wiring for every VS Code webview panel: error boundary, runtime APIs,
 * tooltips and the full-height surface. Panels that need synced session state
 * mount `<SyncProvider>` inside these children themselves, so panels that only
 * render host-supplied content stay out of the sync runtime.
 */
export function VSCodePanelShell({ apis, children }: { apis: RuntimeAPIs; children: ReactNode }) {
  return (
    <ErrorBoundary>
      <RuntimeAPIProvider apis={apis}>
        <TooltipProvider delayDuration={300} skipDelayDuration={150}>
          <div className="h-full text-foreground bg-background">{children}</div>
        </TooltipProvider>
      </RuntimeAPIProvider>
    </ErrorBoundary>
  );
}
