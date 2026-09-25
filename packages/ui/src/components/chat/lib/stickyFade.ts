/**
 * Geometry of the soft edge that closes the sticky prompt header.
 *
 * The sticky header keeps a turn's prompt pinned while the answer scrolls under
 * it, so its box paints an opaque background and its last `STICKY_FADE_LENGTH`
 * dissolves into the chat canvas instead of ending the block on a hard line.
 * Two layers can close that edge and they have to agree on the length:
 *
 * - the header element itself, painting `--surface-background` - the design look
 *   at rest, while nothing else covers the bottom of the header's box;
 * - the user message strip (`chat-user-row`), painting `--chat-user-row-bg`.
 *
 * The strip owns the fade whenever it paints a fill. It is a descendant of the
 * header, so its background always composites *above* the header's gradient and
 * hides the header's fade inside the strip's box: a solid fill stopped the strip
 * on a hard edge against the canvas and swallowed the soft edge the header had
 * there. Fading the strip's own background keeps the fill whole for the whole
 * strip and lets its bottom dissolve into the canvas by itself.
 *
 * The fade lives in a background layer - never a mask and never an overlay - so
 * it can only soften what is painted *below* the strip's content. The bubble and
 * the hover action row sitting in the gap the strip reserves below the bubble
 * stay fully opaque, and the answer scrolling under the header is still hidden
 * by the opaque part of both layers.
 */
export const STICKY_FADE_LENGTH = '0.75rem';

/** Paints `fill` over the whole box and dissolves it over the last `STICKY_FADE_LENGTH`. */
export const stickyFadeBackground = (fill: string): { backgroundImage: string } => ({
    backgroundImage: `linear-gradient(to bottom, ${fill} calc(100% - ${STICKY_FADE_LENGTH}), transparent 100%)`,
});
