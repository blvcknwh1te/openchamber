import { cn } from '@/lib/utils';

/**
 * Shared metrics for the tool, reasoning, and service rows of the transcript.
 * Every row type shows the same metadata line, so the classes live once here
 * instead of being copied into each part renderer.
 */
const TOOL_ROW_TEXT_CLASS = '!text-[length:var(--text-meta)] !leading-5 sm:!leading-6 tracking-normal';
export const TOOL_ROW_TITLE_CLASS = cn('typography-meta font-medium', TOOL_ROW_TEXT_CLASS);
export const TOOL_ROW_DESCRIPTION_CLASS = cn('typography-meta', TOOL_ROW_TEXT_CLASS);
