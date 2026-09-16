import type { ChatMessageEntry } from './types';

/**
 * Compaction output is written by OpenCode as an assistant message flagged
 * `summary` (agent `compaction`) after `/compact` or an automatic compaction.
 * It replaces earlier history for the model; it is not an answer the user
 * asked for, so it must never reach the transcript as a message body.
 */
export const isCompactionSummaryMessage = (message: ChatMessageEntry | null | undefined): boolean => {
    if (!message || message.info.role !== 'assistant') {
        return false;
    }
    return message.info.summary === true;
};

/** Assistant messages that belong in the transcript, in their original order. */
export const selectTranscriptMessages = (messages: ChatMessageEntry[]): ChatMessageEntry[] => {
    // Keep the array identity while nothing is filtered out: turn projections
    // are rebuilt on every stream tick and downstream memos compare by
    // reference.
    return messages.some(isCompactionSummaryMessage)
        ? messages.filter((message) => !isCompactionSummaryMessage(message))
        : messages;
};
