import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { TOOL_ROW_TITLE_CLASS } from './parts/toolRowClasses';

/**
 * Marks where the session history was compacted, in place of the command bubble.
 * The command itself is a service action and the generated summary feeds the
 * model's context, so neither belongs in the transcript as message content.
 */
export const CompactionNotice = ({ className }: { className?: string }) => {
  const { t } = useI18n();

  return (
    <div
      className={cn('flex items-center gap-1.5', className)}
      data-compaction-notice="true"
      style={{ color: 'var(--tools-title)' }}
    >
      <Icon name="archive-stack" className="h-3.5 w-3.5" />
      <span className={TOOL_ROW_TITLE_CLASS}>
        {t('chat.compaction.notice')}
      </span>
    </div>
  );
};
