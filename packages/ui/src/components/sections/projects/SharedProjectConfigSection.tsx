import React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProjectSettingsSubsection } from '@/components/sections/projects/ProjectSettingsSubsection';
import { SettingsFieldRow } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import {
  getProjectSetup,
  updateSharedProjectSetup,
  type ProjectRef,
  type ProjectSetup,
} from '@/lib/openchamberConfig';
import { resetSharedSetupTrust } from '@/lib/sharedTrustConfirmation';

type SharedProjectConfigSectionProps = {
  projectRef: ProjectRef;
};

/**
 * The team's shared file for this project: where it is, whether it could be
 * read, the shared plans folder, and the trust answer recorded on this
 * instance. Sharing individual items happens next to the items themselves
 * (actions, setup commands, starters); this block never creates the file on
 * its own except when a plans folder is set.
 */
export const SharedProjectConfigSection: React.FC<SharedProjectConfigSectionProps> = ({ projectRef }) => {
  const { t } = useI18n();
  const [setup, setSetup] = React.useState<ProjectSetup | null>(null);
  const [plansDirDraft, setPlansDirDraft] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    const next = await getProjectSetup(projectRef);
    setSetup(next);
    setPlansDirDraft(next.shared.plansDir ?? '');
  }, [projectRef]);

  React.useEffect(() => {
    let cancelled = false;
    void getProjectSetup(projectRef).then((next) => {
      if (cancelled) return;
      setSetup(next);
      setPlansDirDraft(next.shared.plansDir ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [projectRef]);

  const savePlansDir = React.useCallback(async () => {
    if (!setup) return;
    const next = plansDirDraft.trim();
    if (next === (setup.shared.plansDir ?? '')) return;
    setIsSaving(true);
    try {
      const saved = await updateSharedProjectSetup(projectRef, { plansDir: next || null });
      if (!saved) {
        toast.error(t('settings.projects.shared.toast.shareFailed'));
        setPlansDirDraft(setup.shared.plansDir ?? '');
        return;
      }
      setSetup(saved);
      setPlansDirDraft(saved.shared.plansDir ?? '');
    } finally {
      setIsSaving(false);
    }
  }, [plansDirDraft, projectRef, setup, t]);

  const handleResetTrust = React.useCallback(async () => {
    setIsSaving(true);
    try {
      if (await resetSharedSetupTrust(projectRef)) {
        await load();
      }
    } finally {
      setIsSaving(false);
    }
  }, [load, projectRef]);

  if (!setup) {
    return null;
  }

  const trusted = setup.trust.hash !== null && setup.trust.trusted;
  const status = setup.shared.status === 'invalid'
    ? t('settings.projects.shared.invalid', { path: setup.shared.path, reason: setup.shared.reason ?? '' })
    : setup.shared.status === 'ok'
      ? t('settings.projects.shared.status.ok')
      : t('settings.projects.shared.status.missing');

  return (
    <ProjectSettingsSubsection
      title={t('settings.projects.shared.title')}
      info={t('settings.projects.shared.description')}
      settingsItem="projects.shared"
    >
      <SettingsFieldRow label={t('settings.projects.shared.file')}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-mono text-xs text-foreground">{setup.shared.path}</span>
          <span className={setup.shared.status === 'invalid' ? 'typography-meta text-[var(--status-warning)]' : 'typography-meta text-muted-foreground'}>
            {status}
          </span>
        </div>
      </SettingsFieldRow>

      <SettingsFieldRow
        label={t('settings.projects.shared.plansDir')}
        info={t('settings.projects.shared.plansDirInfo')}
        settingsItem="projects.shared.plansDir"
      >
        <Input
          value={plansDirDraft}
          onChange={(event) => setPlansDirDraft(event.target.value)}
          onBlur={() => void savePlansDir()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
          placeholder={t('settings.projects.shared.plansDirPlaceholder')}
          aria-label={t('settings.projects.shared.plansDirAria')}
          disabled={isSaving}
          className="h-8 rounded-md px-3 font-mono text-xs"
        />
      </SettingsFieldRow>

      {trusted ? (
        <SettingsFieldRow label={t('settings.projects.shared.trusted')}>
          <Button type="button" variant="ghost" size="xs" className="!font-normal" disabled={isSaving} onClick={() => void handleResetTrust()}>
            {t('settings.projects.shared.resetTrust')}
          </Button>
        </SettingsFieldRow>
      ) : null}
    </ProjectSettingsSubsection>
  );
};
