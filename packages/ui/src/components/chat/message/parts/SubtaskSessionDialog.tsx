import * as React from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ChatSurfaceProvider } from '@/components/chat/ChatSurfaceContext';
import ChatEmptyState from '@/components/chat/ChatEmptyState';
import MessageList from '@/components/chat/MessageList';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  useEnsureSessionMessages,
  useSessionMessageLoadState,
  useSessionMessageRecords,
  useSessionStatus,
} from '@/sync/sync-context';
import { isWorkingSessionStatus } from '@/sync/session-status';

interface SubtaskSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  title: string;
  directory?: string | null;
}

/**
 * Shows a subtask session in a dialog. The transcript comes from the same sync
 * store and message components as the main chat, so it also works in layouts
 * without a context panel (mobile, VS Code) where an embedded chat frame has no
 * runtime to connect to.
 */
export const SubtaskSessionDialog: React.FC<SubtaskSessionDialogProps> = ({
  open,
  onOpenChange,
  sessionId,
  title,
  directory,
}) => {
  const fallbackDirectory = useEffectiveDirectory();
  const resolvedDirectory = directory ?? fallbackDirectory ?? undefined;
  const { t } = useI18n();

  useEnsureSessionMessages(sessionId, resolvedDirectory, open);
  const messages = useSessionMessageRecords(sessionId, resolvedDirectory, { enabled: open });
  const loadState = useSessionMessageLoadState(sessionId, resolvedDirectory);
  const status = useSessionStatus(sessionId, resolvedDirectory);

  const isLoading = loadState.status === 'idle' || loadState.status === 'loading';
  const hasMessages = messages.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'w-[min(72rem,94vw)] max-w-[min(72rem,94vw)]',
          'h-[min(52rem,88vh)] max-h-[88vh]',
          'flex flex-col gap-3 overflow-hidden p-4',
        )}
      >
        <DialogTitle className="pr-8 truncate">{title}</DialogTitle>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background">
          {hasMessages ? (
            <ChatSurfaceProvider mode="peek">
              <MessageList
                sessionKey={sessionId}
                messages={messages}
                sessionIsWorking={isWorkingSessionStatus(status)}
                isLoadingOlder={isLoading}
                directory={resolvedDirectory}
              />
            </ChatSurfaceProvider>
          ) : (
            <div className="flex h-full w-full items-center justify-center px-6 text-center">
              {loadState.status === 'error' ? (
                <p className="typography-ui-label text-muted-foreground">
                  {t('chat.container.sessionLoadError.title')}
                </p>
              ) : isLoading ? (
                <p className="typography-ui-label text-muted-foreground">{t('common.loading')}</p>
              ) : (
                <ChatEmptyState />
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

SubtaskSessionDialog.displayName = 'SubtaskSessionDialog';
