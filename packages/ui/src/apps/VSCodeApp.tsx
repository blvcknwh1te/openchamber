import React from 'react';
import { AgentManagerView } from '@/components/views/agent-manager';
import { FireworksProvider } from '@/contexts/FireworksContext';
import { registerRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { Toaster } from '@/components/ui/sonner';
import { ConfigUpdateOverlay } from '@/components/ui/ConfigUpdateOverlay';
import { OpenCodeUpdateToast } from '@/components/update/OpenCodeUpdateToast';
import { AppLinkConfirmDialog } from '@/components/chat/AppLinkConfirmDialog';
import { SharedTrustConfirmDialog } from '@/components/projects/SharedTrustConfirmDialog';
import { VSCodeLayout } from '@/components/layout/VSCodeLayout';
import { usePushVisibilityBeacon } from '@/hooks/usePushVisibilityBeacon';
import { useGlobalSessionsPolling } from '@/hooks/useGlobalSessionsPolling';
import { useRouter } from '@/hooks/useRouter';
import { useWindowTitle } from '@/hooks/useWindowTitle';
import { useRootScrollLock } from '@/hooks/useRootScrollLock';
import { opencodeClient } from '@/lib/opencode/client';
import type { RuntimeAPIs } from '@/lib/api/types';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { useFeatureFlagsStore } from '@/stores/useFeatureFlagsStore';
import { useGitHubAuthStore } from '@/stores/useGitHubAuthStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { SyncProvider } from '@/sync/sync-context';
import { SyncAppEffects } from './AppEffects';
import { useAppFontEffects } from './useAppFontEffects';
import { VSCodePanelShell } from './VSCodePanelShell';
import { VSCodeTableViewerPanel } from './VSCodeTableViewerPanel';

type VSCodePanelType = 'chat' | 'agentManager' | 'tableViewer';

declare global {
  interface Window {
    __OPENCHAMBER_PANEL_TYPE__?: VSCodePanelType;
    __OPENCHAMBER_TABLE_MARKDOWN__?: string | null;
  }
}

type VSCodeAppProps = {
  apis: RuntimeAPIs;
};

export function VSCodeApp({ apis }: VSCodeAppProps) {
  if (window.__OPENCHAMBER_PANEL_TYPE__ === 'tableViewer') {
    return <VSCodeTableViewerPanel apis={apis} />;
  }

  return <VSCodeSessionPanel apis={apis} />;
}

function VSCodeSessionPanel({ apis }: VSCodeAppProps) {
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const error = useSessionUIStore((state) => state.error);
  const clearError = useSessionUIStore((state) => state.clearError);
  const wideChatLayoutEnabled = useUIStore((state) => state.wideChatLayoutEnabled);
  const refreshGitHubAuthStatus = useGitHubAuthStore((state) => state.refreshStatus);
  const setPlanModeEnabled = useFeatureFlagsStore((state) => state.setPlanModeEnabled);
  const panelType = typeof window !== 'undefined'
    ? window.__OPENCHAMBER_PANEL_TYPE__
    : 'chat';

  React.useEffect(() => {
    registerRuntimeAPIs(apis);
    return () => registerRuntimeAPIs(null);
  }, [apis]);

  useAppFontEffects();
  usePushVisibilityBeacon({ enabled: true });
  useWindowTitle();
  useRootScrollLock();
  useRouter();
  useGlobalSessionsPolling(panelType !== 'agentManager');

  React.useEffect(() => {
    document.documentElement.classList.toggle('wide-chat-layout', wideChatLayoutEnabled);
    return () => {
      document.documentElement.classList.remove('wide-chat-layout');
    };
  }, [wideChatLayoutEnabled]);

  React.useEffect(() => {
    void refreshGitHubAuthStatus(apis.github, { force: true });
  }, [apis.github, refreshGitHubAuthStatus]);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const res = await runtimeFetch('/health', { method: 'GET' }).catch(() => null);
      if (!res || !res.ok || cancelled) return;
      const data = (await res.json().catch(() => null)) as null | {
        planModeExperimentalEnabled?: unknown;
      };
      if (!data || cancelled) return;
      const raw = data.planModeExperimentalEnabled;
      const enabled = raw === true || raw === 1 || raw === '1' || raw === 'true';
      setPlanModeEnabled(enabled);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [setPlanModeEnabled]);

  React.useEffect(() => {
    if (!error) {
      return;
    }

    const timeout = window.setTimeout(() => clearError(), 5000);
    return () => window.clearTimeout(timeout);
  }, [clearError, error]);

  if (panelType === 'agentManager') {
    return (
      <VSCodePanelShell apis={apis}>
        <SyncProvider sdk={opencodeClient.getSdkClient()} directory={currentDirectory || ''}>
          <SyncAppEffects embeddedBackgroundWorkEnabled={true} />
          <AgentManagerView />
          <AppLinkConfirmDialog />
          <SharedTrustConfirmDialog />
          <OpenCodeUpdateToast />
          <Toaster position="top-center" />
        </SyncProvider>
      </VSCodePanelShell>
    );
  }

  return (
    <VSCodePanelShell apis={apis}>
      <SyncProvider sdk={opencodeClient.getSdkClient()} directory={currentDirectory || ''}>
        <FireworksProvider>
          <SyncAppEffects embeddedBackgroundWorkEnabled={true} />
          <VSCodeLayout />
          <AppLinkConfirmDialog />
          <SharedTrustConfirmDialog />
          <OpenCodeUpdateToast />
          <Toaster position="top-center" />
          <ConfigUpdateOverlay />
        </FireworksProvider>
      </SyncProvider>
    </VSCodePanelShell>
  );
}
