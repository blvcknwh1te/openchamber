import React from 'react';

import type { ChatMessageEntry, Turn } from '../lib/turns/types';
import { stickyFadeBackground } from '../lib/stickyFade';
import TurnAssistantBlock from './TurnAssistantBlock';

interface TurnItemProps {
    turn: Turn;
    stickyUserHeader?: boolean;
    renderMessage: (message: ChatMessageEntry) => React.ReactNode;
    assistantContent?: React.ReactNode;
}

/**
 * The sticky user header paints the chat background so assistant content scrolling
 * underneath disappears behind it. The soft edge lives in the header's own background
 * instead of an overlay below it: the bottom 0.75rem of the header box fades the
 * background out, and that strip sits over the empty space the user bubble already
 * reserves below itself. At rest the strip reveals the identical page background
 * (`--background` is generated from the same `surface.background` token), so it is
 * invisible and can never wash over the assistant content that follows.
 *
 * This layer closes the header's edge only while nothing paints over it. A user
 * message strip that fills its box (`--chat-user-row-bg`) composites above this
 * gradient, so the strip carries the same fade in its own background - see
 * `stickyFadeBackground` in `../lib/stickyFade`, which owns the shared length and
 * explains why the strip and not the header has to fade there.
 */
const STICKY_HEADER_BACKGROUND: React.CSSProperties = stickyFadeBackground('var(--surface-background)');

type TurnContentBlock =
    | { kind: 'notice'; key: string; message: ChatMessageEntry }
    | { kind: 'answers'; key: string; messages: ChatMessageEntry[] };

const TurnItem: React.FC<TurnItemProps> = ({ turn, stickyUserHeader = true, renderMessage, assistantContent }) => {
    // A compaction notice keeps its place in the turn's flow. One turn can hold
    // several of them - every service compaction and every synthetic continuation
    // joins the turn it arrived in - so notices and the answers between them
    // render in transcript order. Opening a turn of its own would leave those
    // answers without the prompt header while they scroll under it.
    const contentBlocks = React.useMemo<TurnContentBlock[] | null>(() => {
        if (turn.noticeMessages.length === 0) {
            return null;
        }

        const answerById = new Map(turn.assistantMessages.map((message) => [message.info.id, message]));
        const noticeById = new Map(turn.noticeMessages.map((message) => [message.info.id, message]));
        const blocks: TurnContentBlock[] = [];
        let answers: ChatMessageEntry[] = [];

        const flushAnswers = () => {
            const first = answers[0];
            if (!first) {
                return;
            }
            blocks.push({ kind: 'answers', key: `answers-${first.info.id}`, messages: answers });
            answers = [];
        };

        turn.messages
            .slice()
            .sort((left, right) => left.order - right.order)
            .forEach((record) => {
                const notice = noticeById.get(record.messageId);
                if (notice) {
                    flushAnswers();
                    blocks.push({ kind: 'notice', key: `notice-${notice.info.id}`, message: notice });
                    return;
                }
                const answer = answerById.get(record.messageId);
                if (answer) {
                    answers.push(answer);
                }
            });

        flushAnswers();
        return blocks;
    }, [turn.assistantMessages, turn.messages, turn.noticeMessages]);

    // Live activity collapses the whole answer block into one node, so it cannot
    // host a notice inside itself: notices in front of the answers stay in front,
    // the rest follow it.
    const { leadingNotices, trailingNotices } = React.useMemo(() => {
        const leading: ChatMessageEntry[] = [];
        const trailing: ChatMessageEntry[] = [];
        let sawAnswers = false;

        contentBlocks?.forEach((block) => {
            if (block.kind === 'answers') {
                sawAnswers = true;
                return;
            }
            (sawAnswers ? trailing : leading).push(block.message);
        });

        return { leadingNotices: leading, trailingNotices: trailing };
    }, [contentBlocks]);

    return (
        <section
            className="relative w-full"
            id={`turn-${turn.turnId}`}
            data-turn-id={turn.turnId}
            data-scroll-spy-id={turn.turnId}
        >
            {stickyUserHeader ? (
                <div
                    className="sticky top-0 z-20 [overflow-anchor:none]"
                    style={STICKY_HEADER_BACKGROUND}
                >
                    <div className="relative z-10">
                        {renderMessage(turn.userMessage)}
                    </div>
                </div>
            ) : (
                renderMessage(turn.userMessage)
            )}

            {assistantContent ? (
                <>
                    {leadingNotices.map((message) => renderMessage(message))}
                    {assistantContent}
                    {trailingNotices.map((message) => renderMessage(message))}
                </>
            ) : contentBlocks ? (
                contentBlocks.map((block) => (
                    block.kind === 'notice' ? (
                        <React.Fragment key={block.key}>
                            {renderMessage(block.message)}
                        </React.Fragment>
                    ) : (
                        <TurnAssistantBlock
                            key={block.key}
                            assistantMessages={block.messages}
                            renderMessage={renderMessage}
                        />
                    )
                ))
            ) : (
                <TurnAssistantBlock assistantMessages={turn.assistantMessages} renderMessage={renderMessage} />
            )}
        </section>
    );
};

export default React.memo(TurnItem);
