import React from 'react';
import { getManagedCredentialSourceLabelKey, getSourceControlProviderLabel } from '@/lib/source-control/identity';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useMobileAppActions } from '@/apps/mobileAppContext';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { GitIdentityProfile, GitIdentitySummary, SourceControlRepositoryBindingResetIntent } from '@/lib/api/types';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { repositoryBindingOwner, useRepositoryBinding } from '@/lib/source-control/repository-binding';
import { useUIStore } from '@/stores/useUIStore';
import { useGitStore } from '@/stores/useGitStore';
import { SettingsStackedField } from '../shared/SettingsSection';
import { AuxiliaryBindingSettings, ProviderSourceControlBindingSettings, TransportBindingSettings } from './RepositoryBindingEditors';

type SourceControlBindingSettingsProps = {
  className?: string;
  directory: string;
  author?: GitIdentitySummary | null;
  allowAuthorApply?: boolean;
};

const RepositoryAuthorEditor = ({ directory }: { directory: string }) => {
  const { t } = useI18n();
  const { git } = useRuntimeAPIs();
  const fetchIdentity = useGitStore((state) => state.fetchIdentity);
  const [profiles, setProfiles] = React.useState<GitIdentityProfile[]>([]);
  const [selected, setSelected] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const generation = React.useRef(0);
  React.useEffect(() => {
    const request = ++generation.current;
    const runtimeKey = getRuntimeKey();
    setLoading(true);
    setError(false);
    void git.getGitIdentities().then((result) => {
      if (request === generation.current && runtimeKey === getRuntimeKey()) setProfiles(result);
    }).catch(() => {
      if (request === generation.current && runtimeKey === getRuntimeKey()) setError(true);
    }).finally(() => {
      if (request === generation.current && runtimeKey === getRuntimeKey()) setLoading(false);
    });
    return () => { generation.current += 1; };
  }, [git, directory, retry]);

  const applyAuthor = async () => {
    if (!directory || saving || loading || !profiles.some((profile) => profile.id === selected)) return;
    const request = generation.current;
    const runtimeKey = getRuntimeKey();
    const isCurrent = () => request === generation.current && runtimeKey === getRuntimeKey();
    setSaving(true);
    setError(false);
    try {
      const result = await git.setGitIdentity(directory, selected);
      if (!isCurrent()) return;
      if (!result.success) { setError(true); return; }
      await fetchIdentity(directory, git);
      if (isCurrent()) setSelected('');
    } catch {
      if (isCurrent()) setError(true);
    } finally {
      if (isCurrent()) setSaving(false);
    }
  };
  const selectedProfile = profiles.find((profile) => profile.id === selected);

  return <div className="min-w-0 space-y-2 border-t border-border pt-4">
    <SettingsStackedField label={t('gitView.context.author')}>
      <Select value={selected} onValueChange={setSelected} disabled={loading || saving || profiles.length === 0}>
        <SelectTrigger size="settings" className="w-full" aria-label={t('gitView.context.author')}>
          <SelectValue placeholder={t(loading ? 'settings.sourceControl.binding.loading' : profiles.length ? 'gitView.header.identityTooltip' : 'gitView.header.noProfiles')}>
            {selectedProfile ? `${selectedProfile.name} · ${selectedProfile.userEmail}` : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>{profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>
          {profile.name} · {profile.userEmail}
        </SelectItem>)}</SelectContent>
      </Select>
    </SettingsStackedField>
    <Button size="sm" variant="outline" className="max-w-full" disabled={!selected || loading || saving} onClick={() => void applyAuthor()}>
      <span className="truncate">{t('gitView.context.applyAuthor')}</span>
    </Button>
    {error ? <div role="alert" className="typography-micro text-[var(--status-error)]">
      {t('gitView.toast.applyIdentityFailed')}
      <Button size="xs" variant="ghost" disabled={saving || loading} onClick={() => setRetry((value) => value + 1)}>{t('settings.sourceControl.transport.retry')}</Button>
    </div> : null}
  </div>;
};

export const SourceControlBindingSettings: React.FC<SourceControlBindingSettingsProps> = ({ className, directory, author, allowAuthorApply = false }) => {
  const { t } = useI18n();
  const { sourceControl } = useRuntimeAPIs();
  const mobileActions = useMobileAppActions();
  const binding = useRepositoryBinding(directory, sourceControl);
  const [openScope, setOpenScope] = React.useState<typeof binding.scope | null>(null);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [resetError, setResetError] = React.useState(false);
  const resetRequestRef = React.useRef(0);
  const open = openScope === binding.scope;
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);
  const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen);
  const read = binding.read;
  const providers = read?.binding?.providers ?? [];
  const remotes = read?.repository.remotes ?? [];
  const grants = new Map((read?.binding?.remotes ?? []).map((grant) => [grant.name, grant]));
  const ready = binding.status === 'ready';
  const emptyContext = t(read ? 'gitView.context.notConfigured' : binding.error ? 'gitView.context.needsAttention'
    : directory ? 'settings.sourceControl.binding.loading' : 'settings.sourceControl.binding.noRepository');

  React.useLayoutEffect(() => {
    resetRequestRef.current += 1;
    setResetOpen(false);
    setResetting(false);
    setResetError(false);
    return () => { resetRequestRef.current += 1; };
  }, [binding.scope, sourceControl]);

  const resetBinding = async (): Promise<void> => {
    if (resetting || binding.status !== 'ready' || !binding.isCurrent() || !read?.binding) return;
    const request = resetRequestRef.current;
    const runtimeKey = getRuntimeKey();
    const isCurrent = () => request === resetRequestRef.current && runtimeKey === getRuntimeKey();
    const mutationScope = repositoryBindingOwner.captureMutation(binding.scope, read);
    const intent: SourceControlRepositoryBindingResetIntent = {
      directory,
      expectedRepositoryId: read.repository.repositoryId,
      expectedRevision: read.revision,
      expectedConfigRevision: read.repository.configRevision,
      confirmed: true,
    };
    setResetting(true);
    setResetError(false);
    try {
      const result = await sourceControl.resetRepositoryBinding(intent);
      if (!repositoryBindingOwner.setMutationResult(mutationScope, result)) {
        await repositoryBindingOwner.reconcile(mutationScope, sourceControl);
      }
      if (isCurrent()) setResetOpen(false);
    } catch {
      if (isCurrent()) setResetError(true);
      await repositoryBindingOwner.reconcile(mutationScope, sourceControl);
    } finally {
      mutationScope.release();
      if (isCurrent()) setResetting(false);
    }
  };

  // The strip is its own container: on a narrow pane the summary claims the
  // whole row so the action wraps beneath it, instead of being squeezed into
  // the width left over beside the button.
  return <div className={cn('@container shrink-0 min-w-0 border-b border-border px-4 pb-2', className)} aria-label={t('gitView.context.ariaLabel')}>
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1 basis-full @xl:basis-48 typography-micro text-muted-foreground break-words" data-binding-revision={read?.revision}>
        {providers.length ? providers.map((provider) => {
          return <div key={JSON.stringify([provider.provider, provider.instance, provider.accountId, provider.primaryRemote])}>
            {t('gitView.context.provider')}: {getSourceControlProviderLabel(provider.provider)} · {provider.instance} · {provider.primaryRemote}
            {' · '}{t(ready && provider.readiness === 'ready' ? 'gitView.context.ready' : 'gitView.context.needsAttention')}
          </div>;
        }) : <div>{t('gitView.context.provider')}: {emptyContext}</div>}
        {remotes.length ? remotes.map((remote) => {
          const grant = grants.get(remote.name);
          return <div key={remote.name}>{t('gitView.context.transport')}: {remote.name} · {grant ? <>
            {grant.mode === 'managed' ? grant.presentation?.status === 'available'
              ? grant.presentation.transport === 'ssh'
                ? `SSH · ${grant.presentation.fingerprint}`
                : <>{getSourceControlProviderLabel(grant.presentation.provider)} · {grant.presentation.instance}
                  {' · '}@{grant.presentation.username}{' · '}{t(getManagedCredentialSourceLabelKey(grant.presentation.source))}
                  {' · '}{grant.presentation.providerUserId}</>
              : t('gitView.context.managedCredentialUnavailable')
              : t(grant.mode === 'anonymous' ? 'settings.sourceControl.transport.anonymous' : 'gitView.context.systemUnverified')}
            {' · '}{t(ready && grant.readiness === 'ready' ? 'gitView.context.ready' : 'gitView.context.needsAttention')}
          </> : t('gitView.context.notConfigured')}</div>;
        }) : <div>{t('gitView.context.transport')}: {emptyContext}</div>}
        {author !== undefined ? <div>{t('gitView.context.author')}: {author?.userName && author.userEmail
          ? `${author.userName} <${author.userEmail}>` : t('gitView.context.notConfigured')}</div> : null}
        {binding.stale ? <div role="status">{t('gitView.context.stale')}</div> : null}
        {binding.error ? <div role="alert">{t('settings.gitlab.status.operationFailed')}</div> : null}
      </div>
      <Dialog open={open} onOpenChange={(value) => setOpenScope(value ? binding.scope : null)}>
        <DialogTrigger asChild><Button size="sm" variant="ghost" disabled={!directory}>{t('gitView.context.configure')}</Button></DialogTrigger>
        {open ? <DialogContent className="@container min-w-0">
          <DialogHeader>
            <DialogTitle>{t('gitView.context.configure')}</DialogTitle>
            <DialogDescription>{t('gitView.context.draft')}</DialogDescription>
          </DialogHeader>
          <ProviderSourceControlBindingSettings directory={directory} />
          <TransportBindingSettings directory={directory} />
          <AuxiliaryBindingSettings directory={directory} />
          {allowAuthorApply ? <RepositoryAuthorEditor directory={directory} /> : null}
          {read?.binding ? <div className="min-w-0 space-y-2 border-t border-border pt-4">
            <p className="typography-label text-foreground">{t('settings.sourceControl.reset.title')}</p>
            <p className="typography-micro text-muted-foreground">{t('settings.sourceControl.reset.description')}</p>
            <Dialog open={resetOpen} onOpenChange={(value) => { if (!resetting) { setResetOpen(value); setResetError(false); } }}>
              <DialogTrigger asChild><Button size="sm" variant="destructive" disabled={resetting || binding.status !== 'ready'}>
                {t('settings.sourceControl.reset.action')}
              </Button></DialogTrigger>
              {resetOpen ? <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('settings.sourceControl.reset.confirmTitle')}</DialogTitle>
                  <DialogDescription>{t('settings.sourceControl.reset.confirmDescription')}</DialogDescription>
                </DialogHeader>
                {resetError ? <p role="alert" className="typography-micro text-[var(--status-error)]">
                  {t('settings.sourceControl.reset.failed')}
                </p> : null}
                <DialogFooter>
                  <Button size="sm" variant="outline" disabled={resetting} onClick={() => setResetOpen(false)}>
                    {t('gitView.common.cancel')}
                  </Button>
                  <Button size="sm" variant="destructive" disabled={resetting} onClick={() => void resetBinding()}>
                    {t('settings.sourceControl.reset.confirmAction')}
                  </Button>
                </DialogFooter>
              </DialogContent> : null}
            </Dialog>
          </div> : null}
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => {
              setOpenScope(null);
              setSettingsPage('git');
              if (mobileActions) mobileActions.openSettings();
              else setSettingsDialogOpen(true);
            }}>{t('gitView.context.settings')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpenScope(null)}>{t('dialog.common.actions.close')}</Button>
          </DialogFooter>
        </DialogContent> : null}
      </Dialog>
    </div>
  </div>;
};
