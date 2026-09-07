import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/lib/i18n';
import type { GitPublishContext, GitPublishTargets } from '@/lib/boundGitNetworkOperation';

export function PublishDialog({ context, onSelect }: {
  context: GitPublishContext;
  onSelect: (targets: GitPublishTargets | null) => void;
}) {
  const { t } = useI18n();
  const id = React.useId();
  const remotes = context.bindingRead.binding.remotes;
  const trackedRemote = remotes.find((remote) => context.status.tracking?.startsWith(`${remote.name}/`));
  const [pushRemote, setPushRemote] = React.useState('');
  const [pushBranch, setPushBranch] = React.useState(context.status.current);
  const [fetchRemote, setFetchRemote] = React.useState(trackedRemote?.name ?? '');
  const [fetchBranch, setFetchBranch] = React.useState(trackedRemote
    ? context.status.tracking?.slice(trackedRemote.name.length + 1) ?? '' : '');
  const isSync = context.action === 'sync';
  const remoteBranches = (name: string) => context.branches.all
    .filter((ref) => ref.startsWith(`remotes/${name}/`))
    .map((ref) => ref.slice(`remotes/${name}/`.length))
    .filter((ref) => ref !== 'HEAD');
  const fetchBranches = remoteBranches(fetchRemote);
  const destinationBranches = remoteBranches(pushRemote);
  const canSubmit = Boolean(pushRemote && pushBranch.trim() && pushBranch.trim() !== 'HEAD'
    && remotes.find((remote) => remote.name === pushRemote)?.mode !== 'anonymous'
    && (!isSync || (fetchRemote && fetchBranches.includes(fetchBranch))));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onSelect(null); }}>
      <DialogContent className="max-w-lg max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(isSync ? 'gitView.publish.syncTitle' : 'gitView.publish.title')}</DialogTitle>
          <DialogDescription>{t('gitView.publish.description', { branch: context.status.current })}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          const targets: GitPublishTargets = {
            push: { remoteName: pushRemote, ref: `refs/heads/${pushBranch.trim()}` },
          };
          if (isSync) targets.fetch = { remoteName: fetchRemote, ref: `refs/heads/${fetchBranch}` };
          onSelect(targets);
        }}>
          {isSync ? (
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="mb-2 typography-ui-label">{t('gitView.publish.fetchSource')}</legend>
              <Select value={fetchRemote} onValueChange={(value) => { setFetchRemote(value); setFetchBranch(''); }}>
                <SelectTrigger className="w-full" aria-label={t('gitView.publish.fetchSource')}>
                  <SelectValue placeholder={t('gitView.publish.selectRemote')} />
                </SelectTrigger>
                <SelectContent>{remotes.map((remote) => <SelectItem key={remote.name} value={remote.name}>{remote.name}</SelectItem>)}</SelectContent>
              </Select>
              <p className="break-all typography-meta text-muted-foreground">{remotes.find((remote) => remote.name === fetchRemote)?.fetch.displayUrl}</p>
              <Select value={fetchBranch} onValueChange={setFetchBranch}>
                <SelectTrigger className="w-full" aria-label={t('gitView.publish.sourceBranch')}>
                  <SelectValue placeholder={t('gitView.publish.sourceBranch')} />
                </SelectTrigger>
                <SelectContent>{fetchBranches.map((branch) => <SelectItem key={branch} value={branch}>{branch}</SelectItem>)}</SelectContent>
              </Select>
              {fetchRemote && !fetchBranches.length ? <p className="typography-meta text-muted-foreground">{t('gitView.publish.fetchFirst')}</p> : null}
            </fieldset>
          ) : null}
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-2 typography-ui-label">{t('gitView.publish.pushDestination')}</legend>
            <Select value={pushRemote} onValueChange={setPushRemote}>
              <SelectTrigger className="w-full" aria-label={t('gitView.publish.pushDestination')}>
                <SelectValue placeholder={t('gitView.publish.selectRemote')} />
              </SelectTrigger>
              <SelectContent>{remotes.map((remote) => <SelectItem key={remote.name} value={remote.name} disabled={remote.mode === 'anonymous'}>
                {remote.name}{remote.mode === 'anonymous' ? ` · ${t('settings.sourceControl.transport.anonymous')}` : ''}
              </SelectItem>)}</SelectContent>
            </Select>
            <p className="break-all typography-meta text-muted-foreground">{remotes.find((remote) => remote.name === pushRemote)?.push.displayUrl}</p>
            <label htmlFor={`${id}-branch`} className="typography-ui-label">{t('gitView.publish.destinationBranch')}</label>
            <Input id={`${id}-branch`} list={`${id}-branches`} value={pushBranch} onChange={(event) => setPushBranch(event.target.value)} />
            <datalist id={`${id}-branches`}>{destinationBranches.map((branch) => <option key={branch} value={branch} />)}</datalist>
            <p className="break-all typography-meta text-muted-foreground">{`refs/heads/${context.status.current} -> ${pushRemote || '?'}:refs/heads/${pushBranch.trim()}`}</p>
          </fieldset>
          {!remotes.length ? <p className="typography-meta text-muted-foreground">{t('gitView.publish.noGrants')}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onSelect(null)}>{t('gitView.common.cancel')}</Button>
            <Button type="submit" disabled={!canSubmit}>{t(isSync ? 'gitView.sync.syncChanges' : 'gitView.publish.title')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
