import React from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { getSourceControlAuthKey, useSourceControlAuthStore } from '@/stores/useSourceControlAuthStore';
import type { SourceControlDeviceFlowStart } from '@/lib/api/types';
import { useDeviceInfo } from '@/lib/device';
import { cn } from '@/lib/utils';
import { openExternalUrl } from '@/lib/url';
import { useI18n } from '@/lib/i18n';
import { Icon } from "@/components/icon/Icon";
import { SettingsSection, SettingsGroupTitle, SettingsFieldRow } from '@/components/sections/shared/SettingsSection';
import { GITHUB_SOURCE_CONTROL_IDENTITY } from '@/lib/source-control/identity';
import { getRuntimeKey, subscribeRuntimeEndpointWillChange } from '@/lib/runtime-switch';
import { SourceControlAccountList } from './SourceControlAccountList';

type GitHubSettingsProps = {
  /** Rendered inside the Integrations card: no section chrome of its own. */
  embedded?: boolean;
};

export const GitHubSettings: React.FC<GitHubSettingsProps> = ({ embedded = false }) => {
  const { t } = useI18n();
  const { isMobile } = useDeviceInfo();
  const sourceControl = getRegisteredRuntimeAPIs()?.sourceControl;
  const authKey = getSourceControlAuthKey(GITHUB_SOURCE_CONTROL_IDENTITY);
  const authEntry = useSourceControlAuthStore((state) => state.entries[authKey]);
  const status = authEntry?.status ?? null;
  const isLoading = authEntry?.isLoading ?? false;
  const hasChecked = authEntry?.hasChecked ?? false;
  const refreshStatus = useSourceControlAuthStore((state) => state.refreshStatus);
  const refreshInstances = useSourceControlAuthStore((state) => state.refreshInstances);

  const openExternal = React.useCallback(async (url: string) => {
    await openExternalUrl(url);
  }, []);

  const [isBusy, setIsBusy] = React.useState(false);
  const [flow, setFlow] = React.useState<SourceControlDeviceFlowStart | null>(null);
  const [pollIntervalMs, setPollIntervalMs] = React.useState<number | null>(null);
  const [pollAttempt, setPollAttempt] = React.useState(0);
  const pollTimerRef = React.useRef<number | null>(null);
  const flowRuntimeKeyRef = React.useRef('');
  const runtimeGenerationRef = React.useRef(0);
  const captureRuntime = React.useCallback(() => {
    const runtimeKey = getRuntimeKey();
    const generation = runtimeGenerationRef.current;
    return () => generation === runtimeGenerationRef.current && runtimeKey === getRuntimeKey();
  }, []);

  const stopPolling = React.useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPollIntervalMs(null);
  }, []);

  const stopFlow = React.useCallback(() => {
    flowRuntimeKeyRef.current = '';
    setFlow(null);
    stopPolling();
  }, [stopPolling]);

  React.useEffect(() => {
    const unsubscribe = subscribeRuntimeEndpointWillChange(() => {
      runtimeGenerationRef.current += 1;
      setIsBusy(false);
      stopFlow();
    });
    return () => {
      runtimeGenerationRef.current += 1;
      unsubscribe();
    };
  }, [stopFlow]);

  React.useEffect(() => {
    (async () => {
      try {
        if (!hasChecked && sourceControl) {
          await refreshStatus(sourceControl, GITHUB_SOURCE_CONTROL_IDENTITY);
        }
      } catch (error) {
        console.warn('Failed to load GitHub auth status:', error);
      }
    })();
    return () => {
      stopPolling();
    };
  }, [hasChecked, refreshStatus, sourceControl, stopPolling]);

  const startConnect = React.useCallback(async () => {
    const isCurrentRuntime = captureRuntime();
    setIsBusy(true);
    try {
      if (!sourceControl) return;
      const payload = await sourceControl.authStart(GITHUB_SOURCE_CONTROL_IDENTITY);
      if (!isCurrentRuntime()) return;

      flowRuntimeKeyRef.current = getRuntimeKey();
      setFlow(payload);
      setPollAttempt(0);
      setPollIntervalMs(Math.max(1, payload.interval) * 1000);

      const url = payload.verificationUriComplete || payload.verificationUri;
      void openExternal(url);
    } catch (error) {
      if (isCurrentRuntime()) {
        console.error('Failed to start GitHub connect:', error);
        toast.error(t('settings.github.page.toast.startConnectFailed'));
      }
    } finally {
      if (isCurrentRuntime()) setIsBusy(false);
    }
  }, [captureRuntime, openExternal, sourceControl, t]);

  React.useEffect(() => {
    if (!flow?.flowId || !pollIntervalMs) {
      return;
    }
    if (pollTimerRef.current != null) {
      return;
    }

    const poll = async () => {
      const isCurrentRuntime = captureRuntime();
      if (flowRuntimeKeyRef.current !== getRuntimeKey()) {
        stopFlow();
        return;
      }

      try {
        if (!sourceControl) throw new Error('Source control runtime API unavailable');
        const result = await sourceControl.authComplete(GITHUB_SOURCE_CONTROL_IDENTITY, flow.flowId);
        if (!isCurrentRuntime() || flowRuntimeKeyRef.current !== getRuntimeKey()) return;
        if (result.status === 'connected') {
          stopFlow();
          await refreshStatus(sourceControl, GITHUB_SOURCE_CONTROL_IDENTITY, { force: true });
          if (!isCurrentRuntime()) return;
          await refreshInstances(sourceControl, { force: true });
          if (!isCurrentRuntime()) return;
          toast.success(t('settings.github.page.toast.connected'));
          return;
        }

        if (result.status === 'pending' && result.slowDown) {
          setPollIntervalMs((prev) => (prev ? prev + 5000 : 5000));
        }
        if (result.status === 'pending') setPollAttempt((attempt) => attempt + 1);

        if (result.status === 'error') {
          toast.error(result.message || t('settings.github.page.toast.authorizationFailed'));
          stopFlow();
        }
      } catch (error) {
        if (isCurrentRuntime() && flowRuntimeKeyRef.current === getRuntimeKey()) {
          console.warn('GitHub polling failed:', error);
          setPollAttempt((attempt) => attempt + 1);
        }
      }
    };

    pollTimerRef.current = window.setTimeout(() => {
      void poll();
    }, pollIntervalMs);

    return () => {
      if (pollTimerRef.current != null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [captureRuntime, flow, pollAttempt, pollIntervalMs, refreshInstances, refreshStatus, sourceControl, stopFlow, t]);

  const toggleGhCli = React.useCallback(async (disabled: boolean) => {
    const isCurrentRuntime = captureRuntime();
    setIsBusy(true);
    try {
      if (!sourceControl) return;
      await sourceControl.authSetCliDisabled(GITHUB_SOURCE_CONTROL_IDENTITY, disabled);
      if (!isCurrentRuntime()) return;
      await refreshStatus(sourceControl, GITHUB_SOURCE_CONTROL_IDENTITY, { force: true });
      if (!isCurrentRuntime()) return;
      toast.success(disabled ? t('settings.github.page.toast.ghCliDisabled') : t('settings.github.page.toast.ghCliEnabled'));
    } catch (error) {
      if (isCurrentRuntime()) {
        console.error('Failed to update gh CLI setting:', error);
        toast.error(t('settings.github.page.toast.ghCliUpdateFailed'));
      }
    } finally {
      if (isCurrentRuntime()) setIsBusy(false);
    }
  }, [captureRuntime, refreshStatus, sourceControl, t]);

  const removeAccount = React.useCallback(async (accountId: string) => {
    const isCurrentRuntime = captureRuntime();
    setIsBusy(true);
    try {
      stopFlow();
      if (!sourceControl) return;
      await sourceControl.authDisconnect(GITHUB_SOURCE_CONTROL_IDENTITY, accountId);
      if (!isCurrentRuntime()) return;
      await refreshStatus(sourceControl, GITHUB_SOURCE_CONTROL_IDENTITY, { force: true });
      if (!isCurrentRuntime()) return;
      await refreshInstances(sourceControl, { force: true });
      if (!isCurrentRuntime()) return;
      toast.success(t('settings.github.page.toast.disconnected'));
    } catch (error) {
      if (isCurrentRuntime()) {
        console.error('Failed to remove GitHub account:', error);
        toast.error(t('settings.github.page.toast.disconnectFailed'));
      }
    } finally {
      if (isCurrentRuntime()) setIsBusy(false);
    }
  }, [captureRuntime, refreshInstances, refreshStatus, sourceControl, stopFlow, t]);

  if (isLoading && !hasChecked) {
    return null;
  }

  const accounts = status?.accounts ?? [];
  const ghCli = status?.cli ?? null;
  const refreshError = status?.status === 'unreachable' || status?.status === 'temporarily-unavailable'
    ? status.message || t('sessionAuth.error.networkRetry')
    : null;

  const sections = (
    <>
      <SettingsSection
        title={t('settings.github.title')}
        divider={false}
        settingsItem="git.github-account"
        info={t('settings.github.page.tooltip.connectAccount')}
        headerAction={(
          <Button
            data-settings-item="git.github-connect"
            size="sm"
            variant={accounts.length > 0 ? 'outline' : 'default'}
            onClick={startConnect}
            disabled={isBusy}
          >
            {accounts.length > 0 ? t('settings.github.page.actions.addAccount') : t('settings.github.page.actions.connect')}
          </Button>
        )}
      >
      {refreshError && (
        <SettingsFieldRow label={t('sessionAuth.error.networkTitle')} description={refreshError}>
          <Button
            size="sm"
            variant="outline"
            disabled={isBusy || isLoading || !sourceControl}
            onClick={() => {
              if (sourceControl) void refreshStatus(sourceControl, GITHUB_SOURCE_CONTROL_IDENTITY, { force: true });
            }}
          >
            {t('sessionAuth.error.retry')}
          </Button>
        </SettingsFieldRow>
      )}
      {accounts.length === 0 ? (
        !refreshError && <p className="typography-meta text-muted-foreground">{t('settings.github.page.status.notConnected')}</p>
      ) : (
        <SourceControlAccountList
          accounts={accounts}
          avatarAlt={(username) => t('settings.github.page.avatarAlt.withLogin', { login: username })}
          sourceLabel={(account) => account.source === 'cli'
            ? t('settings.github.page.accountSource.cli')
            : t('settings.github.page.accountSource.oauth')}
          statusLabel={(account) => account.status === 'valid'
            ? t('settings.sourceControl.accounts.available')
            : t('settings.sourceControl.accounts.needsAuthentication')}
          renderActions={(account) => (
            <>
              {account.status === 'invalid' ? (
                <Button size="sm" variant="outline" onClick={startConnect} disabled={isBusy}>
                  {t('settings.sourceControl.actions.reauthenticate')}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => account.source === 'cli' ? toggleGhCli(true) : removeAccount(account.id)}
                disabled={isBusy}
              >
                {account.source === 'cli' ? t('settings.github.page.ghCli.actions.disable') : t('settings.sourceControl.actions.remove')}
              </Button>
            </>
          )}
        />
      )}

      {flow && (
        <div className="mt-4 rounded-lg bg-[var(--surface-elevated)]/70 p-4 border border-[var(--interactive-border)]">
          <div className="space-y-1">
            <SettingsGroupTitle>{t('settings.github.page.flow.title')}</SettingsGroupTitle>
            <p className="typography-meta text-muted-foreground">
              {t('settings.github.page.flow.description')}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 mt-4">
            <div className="font-mono text-xl tracking-widest text-foreground bg-[var(--surface-muted)] px-3 py-1.5 rounded-md border border-[var(--interactive-border)]">{flow.userCode}</div>
            <Button size="sm" asChild>
              <a
                href={flow.verificationUriComplete || flow.verificationUri}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('settings.github.page.actions.openGithub')}
              </a>
            </Button>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="typography-micro text-muted-foreground animate-pulse">
              {t('settings.github.page.flow.waiting')}
            </span>
            <Button size="sm" variant="ghost" disabled={isBusy} onClick={stopFlow}>
              {t('settings.common.actions.cancel')}
            </Button>
          </div>
        </div>
      )}

      </SettingsSection>

      {ghCli?.available && !ghCli?.active && (!ghCli.user || ghCli.disabled) && (
        <SettingsSection title={t('settings.github.page.ghCli.title')}>
          <div className="rounded-lg bg-[var(--surface-elevated)]/70 overflow-hidden">
            <div className={cn("px-4 py-3", isMobile ? "flex flex-col gap-3" : "flex items-center justify-between gap-4")}>
              <div className={cn("flex min-w-0 items-center gap-4", isMobile ? "w-full" : undefined)}>
                {ghCli.user?.avatarUrl ? (
                  <img
                    src={ghCli.user.avatarUrl}
                    alt={ghCli.user.username ? t('settings.github.page.avatarAlt.withLogin', { login: ghCli.user.username }) : t('settings.github.page.avatarAlt.fallback')}
                    className="h-10 w-10 shrink-0 rounded-full border border-[var(--interactive-border)] bg-[var(--surface-muted)] object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--interactive-border)] bg-[var(--surface-muted)]">
                    <Icon name="github-fill" className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  {!ghCli.disabled && ghCli.user && (
                    <div className="typography-ui-label text-foreground truncate">
                      {ghCli.user.name?.trim() || ghCli.user.username || 'GitHub'}
                    </div>
                  )}
                  {!ghCli.disabled && ghCli.user?.username && (
                    <div className={cn("flex items-center gap-2 typography-meta text-muted-foreground mt-0.5", isMobile ? "flex-wrap" : "truncate")}>
                      <Icon name="github-fill" className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-mono">{ghCli.user.username}</span>
                      {ghCli.user.email && <span className="opacity-50">•</span>}
                      {ghCli.user.email && <span>{ghCli.user.email}</span>}
                    </div>
                  )}
                  <div className={cn("typography-meta text-muted-foreground", ghCli.disabled ? "opacity-60" : undefined)}>
                    {ghCli.disabled
                      ? t('settings.github.page.ghCli.disabledDescription')
                      : t('settings.github.page.ghCli.fallbackDescription')}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => toggleGhCli(!ghCli.disabled)}
                disabled={isBusy}
                className={cn(isMobile ? "w-full" : undefined)}
              >
                {ghCli.disabled
                  ? t('settings.github.page.ghCli.actions.enable')
                  : t('settings.github.page.ghCli.actions.disable')}
              </Button>
            </div>
          </div>
        </SettingsSection>
      )}
    </>
  );

  return embedded ? <div className="space-y-4">{sections}</div> : sections;
};
