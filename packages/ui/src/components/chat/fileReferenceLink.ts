/**
 * Attributes and budget of the clickable file references a rendered message
 * carries. The annotation pass and the click handlers live in different
 * modules and have to agree on these names, so they are defined here instead of
 * being repeated as literals in each of them.
 */

export const FILE_LINK_ATTR = 'data-openchamber-file-link';
export const FILE_LINK_REF_ATTR = 'data-openchamber-file-ref';
export const FILE_LINK_PATH_ATTR = 'data-openchamber-file-path';
export const FILE_LINK_DIR_ATTR = 'data-openchamber-file-dir';
export const FILE_LINK_SELECTOR = `[${FILE_LINK_ATTR}="true"]`;

/**
 * The rendered container the budget is measured on. A structural type keeps the
 * renderer free to hand over the element it holds, whatever DOM implementation
 * provides it.
 */
export type FileLinkContainer = {
  querySelectorAll: (selector: string) => ArrayLike<unknown>;
};

/** Links the container already carries. */
export const countGrantedFileLinks = (container: FileLinkContainer): number =>
  container.querySelectorAll(FILE_LINK_SELECTOR).length;

/**
 * Whether the container has room for one more link.
 *
 * The budget counts granted links, never the path-shaped tokens a message
 * holds: log fragments and dotted identifiers outnumber real references by far,
 * and spending the budget on them used to leave every later reference unlinked.
 */
export const hasFileLinkBudget = (container: FileLinkContainer, limit: number): boolean =>
  countGrantedFileLinks(container) < limit;
