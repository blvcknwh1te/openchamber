import React from 'react';
import { Icon } from '@/components/icon/Icon';
import type { SourceControlAuthAccount } from '@/lib/api/types';

type SourceControlAccountGroup = {
  key: string;
  accounts: SourceControlAuthAccount[];
};

const groupSourceControlAccounts = (
  accounts: SourceControlAuthAccount[],
): SourceControlAccountGroup[] => {
  const groups = new Map<string, SourceControlAccountGroup>();
  for (const account of accounts) {
    const key = JSON.stringify([
      account.user.provider,
      account.user.instance,
      account.user.id,
    ]);
    const group = groups.get(key);
    if (group) {
      group.accounts.push(account);
    } else {
      groups.set(key, { key, accounts: [account] });
    }
  }
  return Array.from(groups.values());
};

type SourceControlAccountListProps = {
  accounts: SourceControlAuthAccount[];
  avatarAlt: (username: string) => string;
  sourceLabel: (account: SourceControlAuthAccount) => string;
  statusLabel: (account: SourceControlAuthAccount) => string;
  renderActions: (account: SourceControlAuthAccount) => React.ReactNode;
};

export const SourceControlAccountList: React.FC<SourceControlAccountListProps> = ({
  accounts,
  avatarAlt,
  sourceLabel,
  statusLabel,
  renderActions,
}) => (
  <div className="divide-y divide-[var(--surface-subtle)]">
    {groupSourceControlAccounts(accounts).map((group) => {
      const user = group.accounts[0].user;
      return (
        <div key={group.key} className="py-3 first:pt-0 last:pb-0">
          <div className="flex min-w-0 items-center gap-3">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={avatarAlt(user.username)}
                className="size-9 shrink-0 rounded-full border border-border bg-muted object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                <Icon
                  name={user.provider === 'github' ? 'github-fill' : user.provider === 'gitlab' ? 'gitlab-fill' : 'git-branch'}
                  className="size-4 text-muted-foreground"
                />
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate typography-ui-label text-foreground">
                {user.name?.trim() || user.username}
              </div>
              <div className="truncate font-mono typography-micro text-muted-foreground">
                {user.username}
              </div>
            </div>
          </div>
          <div className="ml-12 mt-2 divide-y divide-[var(--surface-subtle)]">
            {group.accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0 @xl:flex-row @xl:items-center @xl:justify-between"
              >
                <div className="flex flex-wrap items-center gap-1.5 typography-micro text-muted-foreground">
                  <span>{sourceLabel(account)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{statusLabel(account)}</span>
                </div>
                <div className="flex flex-wrap gap-2">{renderActions(account)}</div>
              </div>
            ))}
          </div>
        </div>
      );
    })}
  </div>
);
