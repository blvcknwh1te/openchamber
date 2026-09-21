import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { formatDateTimeForPreference } from '@/lib/timeFormat';
import { formatCompactTokens } from '@/lib/tokenFormat';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores/useConfigStore';
import { useUIStore } from '@/stores/useUIStore';
import { SimpleMarkdownRenderer } from '../MarkdownRenderer';

import type { CompactionPart } from '../lib/messageDisplayNormalization';
import type { CompactionContext } from '../lib/turns/compactionContext';
import { TOOL_ROW_TITLE_CLASS } from './parts/toolRowClasses';

interface CompactionNoticeProps {
  className?: string;
  part: CompactionPart;
  createdAt: number;
  context?: CompactionContext | null;
}

/**
 * Marks where the session history was compacted, in place of the command bubble.
 * The command itself is a service action and the generated summary feeds the
 * model's context, so neither belongs in the transcript as message content.
 * The tooltip answers what the mark stands for: when it ran, whether the user or
 * a full context window triggered it, what the compaction cost and left behind,
 * and that the summary stands in for the earlier messages. Clicking the mark
 * shows that summary itself, since it is the prompt the model now holds.
 */
export const CompactionNotice = ({ className, part, createdAt, context }: CompactionNoticeProps) => {
  const { t } = useI18n();
  const [isSummaryOpen, setIsSummaryOpen] = React.useState(false);
  const timeFormatPreference = useUIStore((state) => state.timeFormatPreference);
  const getCurrentModel = useConfigStore((state) => state.getCurrentModel);

  const modelLimit = getCurrentModel()?.limit;
  const contextLimit = modelLimit?.context ?? 0;

  const compactedAt = formatDateTimeForPreference(createdAt, timeFormatPreference, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const beforeTokens = context?.before ?? 0;
  const afterTokens = context?.after ?? 0;
  const summary = context?.summary ?? null;
  const afterShare = afterTokens > 0 && contextLimit > 0
    ? Math.min(999, Math.round((afterTokens / contextLimit) * 100))
    : null;

  const noticeBody = (
    <>
      <Icon name="archive-stack" className="h-3.5 w-3.5" />
      <span className={TOOL_ROW_TITLE_CLASS}>
        {t('chat.compaction.notice')}
      </span>
    </>
  );

  const noticeClassName = cn('flex items-center gap-1.5', className);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          {summary ? (
            <button
              type="button"
              onClick={() => setIsSummaryOpen(true)}
              className={cn(noticeClassName, 'cursor-pointer')}
              data-compaction-notice="true"
              style={{ color: 'var(--tools-title)' }}
            >
              {noticeBody}
            </button>
          ) : (
            <div
              className={cn(noticeClassName, 'cursor-pointer')}
              data-compaction-notice="true"
              style={{ color: 'var(--tools-title)' }}
            >
              {noticeBody}
            </div>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          <div className="flex flex-col gap-0.5">
            <span>
              {t(part.auto ? 'chat.compaction.tooltip.automatic' : 'chat.compaction.tooltip.manual')}
            </span>
            {part.overflow ? <span>{t('chat.compaction.tooltip.overflow')}</span> : null}
            {beforeTokens > 0 && afterTokens > 0 ? (
              <span>
                {t('chat.compaction.tooltip.tokens', {
                  before: formatCompactTokens(beforeTokens),
                  after: formatCompactTokens(afterTokens),
                })}
              </span>
            ) : beforeTokens > 0 ? (
              <span>
                {t('chat.compaction.tooltip.tokensBefore', { tokens: formatCompactTokens(beforeTokens) })}
              </span>
            ) : afterTokens > 0 ? (
              <span>
                {t('chat.compaction.tooltip.tokensAfter', { tokens: formatCompactTokens(afterTokens) })}
              </span>
            ) : null}
            {afterShare !== null ? (
              <span>{t('chat.compaction.tooltip.tokensShare', { percent: afterShare })}</span>
            ) : null}
            <span>{t('chat.compaction.tooltip.effect')}</span>
            {summary ? <span>{t('chat.compaction.tooltip.viewSummary')}</span> : null}
            <span className="opacity-70">{t('chat.compaction.tooltip.time', { time: compactedAt })}</span>
          </div>
        </TooltipContent>
      </Tooltip>
      {summary ? (
        <Dialog open={isSummaryOpen} onOpenChange={setIsSummaryOpen}>
          <DialogContent className="w-[min(64rem,94vw)] max-w-[min(64rem,94vw)] max-h-[85vh]">
            <DialogTitle>{t('chat.compaction.notice')}</DialogTitle>
            <div className="min-h-0 overflow-y-auto pr-1">
              <SimpleMarkdownRenderer content={summary} variant="tool" />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
};
