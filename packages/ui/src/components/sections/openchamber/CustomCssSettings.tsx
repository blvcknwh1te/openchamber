import React from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { SettingsFieldRow, SettingsSection } from '@/components/sections/shared/SettingsSection';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useI18n } from '@/lib/i18n';
import { DEFAULT_CUSTOM_CSS, getCustomCssPath } from '@/lib/customCss';

/**
 * Custom.css actions for the VS Code runtime. The extension host owns the file
 * location, the shared UI owns the default template (`lib/customCss.ts`).
 *
 * Renders nothing when the host exposes no capability — the same condition the
 * `appearance.custom-css` search registry item gates on.
 */
export const CustomCssSettings: React.FC = () => {
    const { t } = useI18n();
    const runtimeApis = useRuntimeAPIs();
    const [pending, setPending] = React.useState<'open' | 'reset' | null>(null);

    const openCustomCss = runtimeApis.vscode?.openCustomCss;
    const resetCustomCss = runtimeApis.vscode?.resetCustomCss;
    const customCssPath = getCustomCssPath();

    if (!openCustomCss || !resetCustomCss) {
        return null;
    }

    const runAction = async (action: 'open' | 'reset', execute: (template: string) => Promise<void>) => {
        setPending(action);
        try {
            await execute(DEFAULT_CUSTOM_CSS);
            if (action === 'reset') {
                toast.success(t('settings.openchamber.customCss.resetDone'));
            }
        } catch {
            toast.error(t('settings.openchamber.customCss.failed'));
        } finally {
            setPending(null);
        }
    };

    return (
        <SettingsSection
            title={t('settings.openchamber.customCss.section')}
            info={t('settings.openchamber.customCss.sectionInfo')}
        >
            <SettingsFieldRow
                label={t('settings.openchamber.customCss.field.label')}
                info={customCssPath
                    ? t('settings.openchamber.customCss.field.infoWithPath', { path: customCssPath })
                    : t('settings.openchamber.customCss.field.info')}
                settingsItem="appearance.custom-css"
                controlClassName="flex-wrap"
            >
                <Button
                    size="sm"
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => void runAction('open', openCustomCss)}
                >
                    {t('settings.openchamber.customCss.actions.open')}
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => void runAction('reset', resetCustomCss)}
                >
                    {t('settings.openchamber.customCss.actions.reset')}
                </Button>
            </SettingsFieldRow>
        </SettingsSection>
    );
};
