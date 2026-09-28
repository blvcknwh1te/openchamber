/**
 * What the single back control in the mobile Settings header does (DEV1-96).
 * The mobile header owns exactly one control on the left, so its meaning is
 * decided here instead of being scattered across the JSX.
 */
export type MobileBackAction = 'hidden' | 'close' | 'previous';

export interface MobileBackInput {
  /** Mobile layout is forced by the narrow VS Code panel as well as by phones. */
  isMobile: boolean;
  /** Settings navigation stage: the root list or one of its subpages. */
  stage: 'nav' | 'page-sidebar' | 'page-content';
  /** Whether Settings can be left, i.e. a close handler was provided. */
  canClose: boolean;
}

/**
 * A subpage always steps one level up inside Settings. At the root there is no
 * level above, so the control leaves Settings exactly like the X button on the
 * right of the same header; without a close handler there is nowhere to return
 * to at the root, and no control is rendered.
 */
export const resolveMobileBackAction = ({ isMobile, stage, canClose }: MobileBackInput): MobileBackAction => {
  if (!isMobile) return 'hidden';
  if (stage !== 'nav') return 'previous';
  return canClose ? 'close' : 'hidden';
};
