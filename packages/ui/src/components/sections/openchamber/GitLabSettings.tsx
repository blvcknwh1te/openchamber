import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { openExternalUrl } from '@/lib/url';
import { useI18n } from '@/lib/i18n';
import { getManagedCredentialSourceLabelKey } from '@/lib/source-control/identity';
import type {
  SourceControlCapabilities,
  SourceControlAPI,
  SourceControlDeviceFlowStart,
  SourceControlIdentity,
} from '@/lib/api/types';
import {
  SETTINGS_CONTROL_CLUSTER_CLASS,
  SETTINGS_FIELDS_STACK_CLASS,
  SettingsControlGroup,
  SettingsFieldRow,
  SettingsSection,
} from '@/components/sections/shared/SettingsSection';
import { useSourceControlAuthEntry, useSourceControlAuthStore } from '@/stores/useSourceControlAuthStore';
import { getRuntimeKey, subscribeRuntimeEndpointWillChange } from '@/lib/runtime-switch';
import { SourceControlAccountList } from './SourceControlAccountList';

const DEFAULT_GITLAB_IDENTITY: SourceControlIdentity = { provider: 'gitlab', instance: 'https://gitlab.com' };

const normalizeGitLabIdentity = (value: string): SourceControlIdentity | null => {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname.toLowerCase());
    const hasUnsupportedParts = Boolean(
      url.username
      || url.password
      || url.search
      || url.hash
      || (url.pathname && url.pathname !== '/'),
    );
    const hasSupportedProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && loopback);

    if (hasUnsupportedParts || !hasSupportedProtocol) return null;
    return { provider: 'gitlab', instance: url.origin };
  } catch {
    return null;
  }
};

interface GitLabInstanceItemProps {
  identity: SourceControlIdentity;
  sourceControl: SourceControlAPI;
  onSaved?: () => void;
}

const GitLabInstanceItem: React.FC<GitLabInstanceItemProps> = ({ identity, sourceControl, onSaved }) => {
  const { t } = useI18n();
  const refreshInstances = useSourceControlAuthStore((state) => state.refreshInstances);
  const refreshStatus = useSourceControlAuthStore((state) => state.refreshStatus);
  const setStatus = useSourceControlAuthStore((state) => state.setStatus);
  const authEntry = useSourceControlAuthEntry(identity);
  const [capabilities, setCapabilities] = React.useState<SourceControlCapabilities | null>(null);
  const [capabilitiesFailed, setCapabilitiesFailed] = React.useState(false);
  const [capabilitiesAttempt, setCapabilitiesAttempt] = React.useState(0);
  const [flow, setFlow] = React.useState<SourceControlDeviceFlowStart | null>(null);
  const [pollDelayMs, setPollDelayMs] = React.useState(0);
  const [pollAttempt, setPollAttempt] = React.useState(0);
  const [token, setToken] = React.useState('');
  const [isAddingAccount, setIsAddingAccount] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [operationFailed, setOperationFailed] = React.useState(false);
  const flowRuntimeKeyRef = React.useRef('');
  const runtimeGenerationRef = React.useRef(0);
  const captureRuntime = React.useCallback(() => {
    const runtimeKey = getRuntimeKey();
    const generation = runtimeGenerationRef.current;
    return () => generation === runtimeGenerationRef.current && runtimeKey === getRuntimeKey();
  }, []);
  const status = authEntry?.status ?? null;
  const accounts = status?.accounts ?? [];
  const cli = status && 'cli' in status ? status.cli : undefined;

  const stopFlow = React.useCallback(() => {
    flowRuntimeKeyRef.current = '';
    setFlow(null);
    setPollDelayMs(0);
  }, []);

  React.useEffect(() => {
    const unsubscribe = subscribeRuntimeEndpointWillChange(() => {
      runtimeGenerationRef.current += 1;
      stopFlow();
    });
    return () => {
      runtimeGenerationRef.current += 1;
      unsubscribe();
    };
  }, [stopFlow]);
  React.useEffect(() => stopFlow(), [identity.instance, identity.provider, stopFlow]);

  React.useEffect(() => {
    let cancelled = false;
    const isCurrentRuntime = captureRuntime();
    setCapabilitiesFailed(false);
    void Promise.all([
      sourceControl.capabilities(identity),
      refreshStatus(sourceControl, identity),
    ]).then(([nextCapabilities]) => {
      if (!cancelled && isCurrentRuntime()) setCapabilities(nextCapabilities);
    }).catch(() => {
      if (!cancelled && isCurrentRuntime()) setCapabilitiesFailed(true);
    });
    return () => { cancelled = true; };
  }, [capabilitiesAttempt, captureRuntime, identity, refreshStatus, sourceControl]);

  React.useEffect(() => {
    if (!flow || pollDelayMs <= 0) return;

    const poll = async () => {
      const isCurrentRuntime = captureRuntime();
      if (flowRuntimeKeyRef.current !== getRuntimeKey()) {
        stopFlow();
        return;
      }

      try {
        const result = await sourceControl.authComplete(identity, flow.flowId);
        if (!isCurrentRuntime() || flowRuntimeKeyRef.current !== getRuntimeKey()) return;
        if (result.status === 'connected') {
          stopFlow();
          setIsAddingAccount(false);
          await refreshStatus(sourceControl, identity, { force: true });
          if (!isCurrentRuntime()) return;
          await refreshInstances(sourceControl, { force: true });
          if (!isCurrentRuntime()) return;
          onSaved?.();
          setOperationFailed(false);
          return;
        }
        if (result.status === 'pending') {
          setPollDelayMs((result.slowDown ? pollDelayMs + 5_000 : pollDelayMs) || 5_000);
          setPollAttempt((attempt) => attempt + 1);
          return;
        }
        stopFlow();
        setOperationFailed(true);
      } catch {
        if (isCurrentRuntime() && flowRuntimeKeyRef.current === getRuntimeKey()) setPollAttempt((attempt) => attempt + 1);
      }
    };

    const timer = window.setTimeout(() => {
      void poll();
    }, pollDelayMs);
    return () => window.clearTimeout(timer);
  }, [captureRuntime, flow, identity, onSaved, pollAttempt, pollDelayMs, refreshInstances, refreshStatus, sourceControl, stopFlow]);

  const startDeviceFlow = async () => {
    const isCurrentRuntime = captureRuntime();
    setBusy(true);
    setOperationFailed(false);
    try {
      const nextFlow = await sourceControl.authStart(identity);
      if (!isCurrentRuntime()) return;
      flowRuntimeKeyRef.current = getRuntimeKey();
      setFlow(nextFlow);
      setPollAttempt(0);
      setPollDelayMs(Math.max(1, nextFlow.interval) * 1_000);
      await openExternalUrl(nextFlow.verificationUriComplete || nextFlow.verificationUri);
    } catch {
      if (isCurrentRuntime()) setOperationFailed(true);
    } finally {
      if (isCurrentRuntime()) setBusy(false);
    }
  };

  const saveToken = async () => {
    if (!token.trim()) return;
    const isCurrentRuntime = captureRuntime();
    setBusy(true);
    setOperationFailed(false);
    try {
      const nextStatus = await sourceControl.authSetToken(identity, token.trim());
      if (!isCurrentRuntime()) return;
      setStatus(identity, nextStatus);
      setToken('');
      setIsAddingAccount(false);
      await refreshStatus(sourceControl, identity, { force: true });
      if (!isCurrentRuntime()) return;
      await refreshInstances(sourceControl, { force: true });
      if (!isCurrentRuntime()) return;
      onSaved?.();
    } catch {
      if (isCurrentRuntime()) setOperationFailed(true);
    } finally {
      if (isCurrentRuntime()) setBusy(false);
    }
  };

  const removeAccount = async (accountId: string) => {
    const isCurrentRuntime = captureRuntime();
    setBusy(true);
    setOperationFailed(false);
    try {
      await sourceControl.authDisconnect(identity, accountId);
      if (!isCurrentRuntime()) return;
      await refreshStatus(sourceControl, identity, { force: true });
      if (!isCurrentRuntime()) return;
      await refreshInstances(sourceControl, { force: true });
    } catch {
      if (isCurrentRuntime()) setOperationFailed(true);
    } finally {
      if (isCurrentRuntime()) setBusy(false);
    }
  };

  const toggleCli = async () => {
    if (!cli) return;
    const isCurrentRuntime = captureRuntime();
    setBusy(true);
    setOperationFailed(false);
    try {
      await sourceControl.authSetCliDisabled(identity, !cli.disabled);
      if (!isCurrentRuntime()) return;
      await refreshStatus(sourceControl, identity, { force: true });
    } catch {
      if (isCurrentRuntime()) setOperationFailed(true);
    } finally {
      if (isCurrentRuntime()) setBusy(false);
    }
  };

  const cancelAddAccount = () => {
    setIsAddingAccount(false);
    setFlow(null);
    setPollDelayMs(0);
    setPollAttempt(0);
    setToken('');
    setOperationFailed(false);
  };

  const connected = accounts.length > 0;
  const showConnectionMethods = !connected || isAddingAccount;
  let statusMessage: string;
  if (authEntry?.isLoading) {
    statusMessage = t('settings.gitlab.status.checking');
  } else if (operationFailed || capabilitiesFailed || status?.status === 'unreachable') {
    statusMessage = t('settings.gitlab.status.operationFailed');
  } else if (accounts.length > 0) {
    statusMessage = t('settings.sourceControl.accounts.configured');
  } else {
    statusMessage = t('settings.github.page.status.notConnected');
  }

  return (
    <div className="overflow-hidden rounded-lg bg-[var(--surface-elevated)]/70">
      <div className="flex items-start justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="typography-ui-label truncate text-foreground">{identity.instance}</div>
          <div className="typography-meta mt-0.5 text-muted-foreground">
            {statusMessage}
          </div>
        </div>
        {capabilitiesFailed || status?.status === 'unreachable' ? (
          <Button size="sm" variant="outline" disabled={busy || authEntry?.isLoading} onClick={() => setCapabilitiesAttempt((attempt) => attempt + 1)}>
            {t('sessionAuth.error.retry')}
          </Button>
        ) : null}
      </div>

      {accounts.length > 0 ? (
        <div className="border-t border-[var(--surface-subtle)] px-4 py-3">
          <SourceControlAccountList
            accounts={accounts}
            avatarAlt={(username) => username}
            sourceLabel={(account) => t(account.source === 'cli' ? 'settings.gitlab.cli.label' : getManagedCredentialSourceLabelKey(account.source))}
            statusLabel={(account) => account.status === 'valid'
              ? t('settings.sourceControl.accounts.available')
              : t('settings.sourceControl.accounts.needsAuthentication')}
            renderActions={(account) => (
              <>
                {account.status === 'invalid' && account.source !== 'cli' ? (
                  <Button size="sm" variant="outline" onClick={() => setIsAddingAccount(true)} disabled={busy}>
                    {t('settings.sourceControl.actions.reauthenticate')}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => account.source === 'cli' ? toggleCli() : removeAccount(account.id)}
                  disabled={busy}
                >
                  {account.source === 'cli' ? t('settings.gitlab.actions.disableCli') : t('settings.sourceControl.actions.remove')}
                </Button>
              </>
            )}
          />
        </div>
      ) : null}

      {connected && !isAddingAccount && (
        <div className="border-t border-[var(--surface-subtle)] px-4 py-3">
          <Button size="sm" variant="outline" onClick={() => setIsAddingAccount(true)} disabled={busy}>
            {t('settings.github.page.actions.addAccount')}
          </Button>
        </div>
      )}

      {showConnectionMethods && (
        <div className={`${SETTINGS_FIELDS_STACK_CLASS} border-t border-[var(--surface-subtle)] px-4 py-4`}>
          {isAddingAccount && (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={cancelAddAccount} disabled={busy}>
                {t('settings.common.actions.cancel')}
              </Button>
            </div>
          )}
          {capabilities?.authenticationMethods.device.available && !flow && (
            <SettingsFieldRow label={t('settings.gitlab.device.label')}>
            <Button data-settings-item="git.gitlab-connect" size="sm" onClick={startDeviceFlow} disabled={busy}>{t('settings.gitlab.actions.connect')}</Button>
            </SettingsFieldRow>
          )}
          {capabilities?.authenticationMethods.pat.available && (
            <SettingsFieldRow label={t('settings.gitlab.token.label')} info={t('settings.gitlab.token.info')}>
              <div className={`${SETTINGS_CONTROL_CLUSTER_CLASS} flex flex-col gap-2 @xl:flex-row @xl:items-center`}>
                <Input
                  className="w-full min-w-0"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  aria-label={t('settings.gitlab.token.label')}
                />
                <Button data-settings-item="git.gitlab-connect-token" className="w-full @xl:w-auto" size="sm" onClick={saveToken} disabled={busy || !token.trim()}>{t('settings.common.actions.saveChanges')}</Button>
              </div>
            </SettingsFieldRow>
          )}
          {flow && (
            <SettingsFieldRow label={t('settings.gitlab.device.label')} description={t('settings.gitlab.device.waiting')}>
              <div className={`${SETTINGS_CONTROL_CLUSTER_CLASS} flex flex-wrap items-center justify-end gap-2`}>
                <code className="typography-ui-label mr-auto tracking-widest text-foreground">{flow.userCode}</code>
                <Button size="sm" variant="outline" onClick={() => void openExternalUrl(flow.verificationUriComplete || flow.verificationUri)}>
                  {t('settings.gitlab.actions.openGitLab')}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelAddAccount}>{t('settings.common.actions.cancel')}</Button>
              </div>
            </SettingsFieldRow>
          )}
        </div>
      )}

      {(connected || cli?.disabled) && cli && (cli.available || cli.disabled) && (
        <div className="border-t border-[var(--surface-subtle)] px-4 py-3">
          <SettingsFieldRow label={t('settings.gitlab.cli.label')} info={t('settings.gitlab.cli.info')}>
            <Button size="sm" variant="outline" onClick={toggleCli} disabled={busy}>
              {cli.disabled ? t('settings.gitlab.actions.enableCli') : t('settings.gitlab.actions.disableCli')}
            </Button>
          </SettingsFieldRow>
        </div>
      )}
    </div>
  );
};

export const GitLabSettings: React.FC = () => {
  const { t } = useI18n();
  const sourceControl = getRegisteredRuntimeAPIs()?.sourceControl;
  const identities = useSourceControlAuthStore((state) => state.identities);
  const refreshInstances = useSourceControlAuthStore((state) => state.refreshInstances);
  const [pendingIdentity, setPendingIdentity] = React.useState<SourceControlIdentity | null>(null);
  const [instanceInput, setInstanceInput] = React.useState('');
  const [isAddingInstance, setIsAddingInstance] = React.useState(false);
  const [instanceFailed, setInstanceFailed] = React.useState(false);
  const clearPendingIdentity = React.useCallback(() => setPendingIdentity(null), []);
  const gitLabIdentities = identities.filter((item) => item.provider === 'gitlab');
  const visibleIdentities = [...gitLabIdentities];
  if (pendingIdentity && !gitLabIdentities.some((item) => item.instance === pendingIdentity.instance)) {
    visibleIdentities.push(pendingIdentity);
  }
  if (visibleIdentities.length === 0) visibleIdentities.push(DEFAULT_GITLAB_IDENTITY);

  React.useEffect(() => {
    if (sourceControl) void refreshInstances(sourceControl);
  }, [refreshInstances, sourceControl]);

  const applyInstance = () => {
    const normalized = normalizeGitLabIdentity(instanceInput);
    if (!normalized) {
      setInstanceFailed(true);
      return;
    }
    setPendingIdentity(normalized);
    setInstanceInput('');
    setIsAddingInstance(false);
    setInstanceFailed(false);
  };

  if (!sourceControl) return null;

  return (
    <SettingsSection
      title={t('settings.gitlab.title')}
      info={t('settings.gitlab.info')}
      settingsItem="git.gitlab-account"
    >
      <SettingsControlGroup
        title={t('settings.gitlab.instances.title')}
        contentClassName="space-y-3"
        settingsItem="git.gitlab-connect"
      >
        {visibleIdentities.map((item) => (
          <GitLabInstanceItem
            key={`${getRuntimeKey()}:${item.instance}`}
            identity={item}
            sourceControl={sourceControl}
            onSaved={pendingIdentity?.instance === item.instance ? clearPendingIdentity : undefined}
          />
        ))}

        {isAddingInstance && (
          <div className="rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)]/70 px-4 py-4">
            <SettingsFieldRow
              label={t('settings.gitlab.instance.customLabel')}
              info={t('settings.gitlab.instance.customInfo')}
              description={instanceFailed ? t('settings.gitlab.status.operationFailed') : undefined}
            >
              <div className={`${SETTINGS_CONTROL_CLUSTER_CLASS} flex flex-col gap-2 @xl:flex-row @xl:items-center`}>
                <Input
                  className="w-full min-w-0"
                  value={instanceInput}
                  onChange={(event) => setInstanceInput(event.target.value)}
                  placeholder="https://gitlab.example.com"
                  aria-label={t('settings.gitlab.instance.customLabel')}
                />
                <Button className="w-full @xl:w-auto" size="sm" onClick={applyInstance}>{t('settings.gitlab.actions.useInstance')}</Button>
                <Button className="w-full @xl:w-auto" size="sm" variant="ghost" onClick={() => {
                  setInstanceInput('');
                  setIsAddingInstance(false);
                  setInstanceFailed(false);
                }}>
                  {t('settings.common.actions.cancel')}
                </Button>
              </div>
            </SettingsFieldRow>
          </div>
        )}

        {!isAddingInstance && (
          <Button size="sm" variant="outline" onClick={() => setIsAddingInstance(true)}>
            {t('settings.gitlab.actions.addInstance')}
          </Button>
        )}
      </SettingsControlGroup>
    </SettingsSection>
  );
};
