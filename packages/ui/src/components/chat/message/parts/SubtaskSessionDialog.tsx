import * as React from 'react';

import type { LegendListRef } from '@legendapp/list/react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ChatSurfaceProvider } from '@/components/chat/ChatSurfaceContext';
import ChatEmptyState from '@/components/chat/ChatEmptyState';
import MessageList from '@/components/chat/MessageList';
import {
  resolveHistoryScrollThreshold,
  shouldAutoLoadEarlierForUnderfilledPinnedViewport,
} from '@/components/chat/hooks/useChatTimelineController';
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
import { useSync } from '@/sync/use-sync';

// The dialog owns its transcript viewport: LegendList renders the scroll
// container from these props, so the container is a flex item with an explicit
// minimum height instead of a percentage height. A bare `h-full` inside the
// flex column left the list without a bounded box to scroll.
const SUBTASK_TRANSCRIPT_SCROLL_PROPS = {
  className: 'min-h-0 flex-1 overflow-y-auto',
};

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
  const { loadMore } = useSync();

  useEnsureSessionMessages(sessionId, resolvedDirectory, open);
  const messages = useSessionMessageRecords(sessionId, resolvedDirectory, { enabled: open });
  const loadState = useSessionMessageLoadState(sessionId, resolvedDirectory);
  const status = useSessionStatus(sessionId, resolvedDirectory);

  const isLoading = loadState.status === 'idle' || loadState.status === 'loading';
  const isLoadingHistory = loadState.status === 'loading';
  const hasMessages = messages.length > 0;
  const canLoadEarlier = !loadState.complete && Boolean(loadState.cursor);

  const listRef = React.useRef<LegendListRef | null>(null);
  const registerList = React.useCallback((list: LegendListRef | null) => {
    listRef.current = list;
  }, []);

  const loadEarlier = React.useCallback(() => {
    if (!resolvedDirectory) return;
    void loadMore(sessionId, resolvedDirectory);
  }, [loadMore, resolvedDirectory, sessionId]);

  // The dialog renders the transcript itself, so the main chat timeline
  // controller never drives this list: request older pages while the viewport
  // is underfilled or the reader reaches the top of the loaded history.
  React.useEffect(() => {
    if (!open || !canLoadEarlier || isLoadingHistory) return;
    let detach: (() => void) | undefined;
    const frame = window.requestAnimationFrame(() => {
      const node = listRef.current?.getScrollableNode();
      if (!node) return;
      if (shouldAutoLoadEarlierForUnderfilledPinnedViewport({
        sessionId,
        isPinned: true,
        canLoadEarlier,
        isLoadingOlder: isLoadingHistory,
        pendingRevealWork: false,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      })) {
        loadEarlier();
        return;
      }
      const handleScroll = () => {
        if (node.scrollTop < resolveHistoryScrollThreshold(node.clientHeight)) {
          loadEarlier();
        }
      };
      node.addEventListener('scroll', handleScroll, { passive: true });
      detach = () => node.removeEventListener('scroll', handleScroll);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      detach?.();
    };
  }, [canLoadEarlier, isLoadingHistory, loadEarlier, messages.length, open, sessionId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'w-[min(72rem,94vw)] max-w-[min(72rem,94vw)]',
          'h-[min(52rem,88vh)] max-h-[88vh]',
          // The transcript list is the only scroll container here: the dialog
          // popup ships `overflow-y-auto` by default and would scroll as well.
          'flex flex-col gap-3 overflow-hidden overflow-y-hidden p-4',
        )}
      >
        <DialogTitle className="pr-8 truncate">{title}</DialogTitle>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">
          {hasMessages ? (
            <ChatSurfaceProvider mode="peek">
              <MessageList
                sessionKey={sessionId}
                messages={messages}
                sessionIsWorking={isWorkingSessionStatus(status)}
                isLoadingOlder={isLoadingHistory}
                directory={resolvedDirectory}
                registerList={registerList}
                scrollContainerProps={SUBTASK_TRANSCRIPT_SCROLL_PROPS}
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
