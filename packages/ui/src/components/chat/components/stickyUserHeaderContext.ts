import { createContext, useContext } from 'react';

/**
 * True while a user message is rendered as the sticky prompt header — the
 * `stickyUserHeader` branch of `TurnItem`. The header keeps a fixed height, so
 * the parts it renders bound their markdown tables regardless of the
 * `collapsibleUserMessages` setting and of the message's own expanded state.
 *
 * The flag travels as context instead of a prop because the message renderer is
 * shared: `TurnItem` decides sticky per turn, while the props of `MessageBody`
 * and `UserTextPart` are identical for sticky and regular rows.
 */
export const StickyUserHeaderContext = createContext(false);

export const useStickyUserHeader = (): boolean => useContext(StickyUserHeaderContext);
