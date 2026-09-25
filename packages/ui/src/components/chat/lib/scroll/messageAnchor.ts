// DOM anchor of a single transcript message.
//
// `data-message-id` is set on the message's own wrapper (see ChatMessage), so
// it marks the top edge of THAT message. An assistant answer is therefore
// anchored on its own first pixel — never on the sticky user header of the turn
// it belongs to, which is what `data-turn-id` marks and what made the previous
// pin scroll up to the user's message.
//
// The measurement is the one the navigation code already uses to place a
// message under the top of the viewport: the message's viewport-relative
// distance plus the scroll already applied, i.e. its position in the scroll
// container's content space.

export const messageElementSelector = (messageId: string): string => `[data-message-id="${messageId}"]`;

export const queryMessageElement = (container: HTMLElement, messageId: string): HTMLElement | null => (
    container.querySelector<HTMLElement>(messageElementSelector(messageId))
);

// Null when the message is not mounted: a virtualized list may not render the
// target at all, and the caller decides whether to wait for it.
export const measureMessageTop = (container: HTMLElement, messageId: string): number | null => {
    const element = queryMessageElement(container, messageId);
    if (!element) return null;
    const top = element.getBoundingClientRect().top
        - container.getBoundingClientRect().top
        + container.scrollTop;
    return Number.isFinite(top) ? top : null;
};
