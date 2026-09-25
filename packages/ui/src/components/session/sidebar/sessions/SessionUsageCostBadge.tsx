import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';

/**
 * Compact spend chip for a session row: the money a session actually cost, not
 * a token count.
 *
 * `cost` is the row's already-projected subtree total (see
 * `sessionUsageTotals.ts`): the session's own `Session.cost` plus the cost of
 * every sub-session, each session counted once. The chip therefore never
 * recomputes a sum and never re-adds a cached bucket, so the figure cannot
 * inflate the way a cache-heavy token total does.
 *
 * The number is printed by the shared `formatMoney`, which the row tooltip and
 * the context-usage panel use as well, so one session shows one figure
 * everywhere. A row without a reported cost renders nothing rather than a
 * placeholder.
 *
 * The chip shares the metadata slot of the inline model badge: same micro
 * typography, same muted theme token, no emoji, icon from the shared registry.
 * `showLeadingDivider` renders the `·` that separates it from the model name
 * that precedes it, so the row reads `Model · $4.74 · date` with no stray dot
 * when the session has no model to show.
 */
export const SessionUsageCostBadge = ({
  cost,
  showLeadingDivider = false,
}: {
  cost: number | null;
  showLeadingDivider?: boolean;
}) => {
  const { t } = useI18n();
  if (cost === null || !Number.isFinite(cost) || cost <= 0) return null;
  const formatted = formatMoney(cost);
  const label = t('sessions.sidebar.session.tooltip.cost', { cost: formatted });
  return (
    <span
      className="inline-flex flex-shrink-0 items-center gap-1 typography-micro text-muted-foreground/75 tabular-nums"
      role="img"
      aria-label={label}
      title={label}
    >
      {showLeadingDivider ? (
        <span aria-hidden="true" className="text-muted-foreground/40">
          ·
        </span>
      ) : null}
      <Icon name="bar-chart-2" className="h-3 w-3 flex-shrink-0 text-muted-foreground/60" />
      <span>{formatted}</span>
    </span>
  );
};
