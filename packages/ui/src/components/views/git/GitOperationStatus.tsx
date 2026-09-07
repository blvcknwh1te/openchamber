import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import type { GitActionRecovery } from './useGitOperationRecovery';

export function GitOperationStatus({ entry, onRefresh, onCancel }: {
  entry: GitActionRecovery | undefined;
  onRefresh: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  if (!entry || (!entry.reads.length && !entry.localCommit && !entry.pending?.length && !entry.problem)) return null;
  const last = entry.reads.at(-1);
  const canCancel = last?.operation.state === 'planned' || last?.operation.state === 'running';
  const unknown = Boolean(entry.pending?.some((reference) => !entry.reads.some((read) => read.operation.operationId === reference.operationId && read.availability === 'available'))
    || last?.availability === 'unavailable' || last?.operation.state === 'outcome-unknown');
  return (
    <section className="mx-3 mb-2 min-w-0 shrink-0 rounded-lg border border-border bg-[var(--surface-elevated)] p-3 typography-meta" aria-live="polite" aria-busy={entry.checking} aria-label={t('gitView.operation.title')}>
      <div className="max-h-48 overflow-y-auto">
      {entry.problem ? <p className="text-[var(--status-warning)]">{t(`gitView.operation.recovery.${entry.problem}`)}</p> : null}
      {entry.pending?.filter((reference) => !entry.reads.some((read) => read.operation.operationId === reference.operationId)).map((reference) => (
        <p key={reference.operationId} className="space-y-1 py-1 text-muted-foreground">
          <span className="block">{t('gitView.operation.state.unavailable')}</span>
          <code className="break-all typography-micro">{reference.operationId}</code>
        </p>
      ))}
      {entry.localCommit ? <p className="text-foreground">{t('gitView.operation.localCommit')}</p> : null}
      {entry.reads.map(({ operation, availability }) => (
        <div key={operation.operationId} className="space-y-1 py-1">
          <p className="flex flex-wrap items-baseline justify-between gap-2 text-foreground">
            <span>{t(`gitView.operation.state.${availability === 'unavailable' ? 'unavailable' : operation.state}`)}</span>
            <code className="min-w-0 break-all typography-micro text-muted-foreground">{operation.operationId}</code>
          </p>
          {operation.stepResults?.map((step) => <p key={step.step} className="flex justify-between gap-3 text-muted-foreground">
            <span>{t(`gitView.sync.${step.step}`)}</span>
            <span>{t(`gitView.operation.state.${step.status}`)}</span>
          </p>)}
          {operation.completedSteps.map((step) => <p key={step} className="text-muted-foreground">{t(`gitView.operation.completed.${step}`)}</p>)}
          {operation.hydration ? <div className="space-y-1">
            {[...operation.hydration.submodules.map((item) => ({ ...item, kind: 'submodule' as const })),
              ...operation.hydration.lfs.map((item) => ({ ...item, kind: 'lfs' as const }))].map((item) => (
              <p key={`${item.kind}:${item.path}:${item.endpoint?.fingerprint ?? item.status}`} className="break-words text-muted-foreground">
                {item.path} · {t(item.kind === 'submodule' ? 'gitView.hydration.kind.submodule' : 'gitView.hydration.kind.lfs')}
                {' · '}{t(`gitView.hydration.status.${item.status}`)}
                {item.endpoint ? <> · <code>{item.endpoint.displayUrl}</code></> : null}
              </p>
            ))}
          </div> : null}
          {'error' in operation ? <p className="break-words text-muted-foreground"><code>{operation.error.code}</code>: {operation.error.message}</p> : null}
        </div>
      ))}
      {unknown ? <p className="mt-1 text-[var(--status-warning)]">{t('gitView.operation.unknownHint')}</p> : null}
      {unknown ? <p className="mt-1 text-muted-foreground">{t('gitView.operation.recovery.inspect')}</p> : null}
      </div>
      {canCancel || unknown || entry.problem ? <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={entry.checking} onClick={onRefresh}>{t('gitView.operation.refresh')}</Button>
        {canCancel ? <Button variant="outline" size="sm" disabled={entry.checking} onClick={onCancel}>{t('gitView.operation.cancel')}</Button> : null}
      </div> : null}
    </section>
  );
}
