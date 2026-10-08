/**
 * Opening a changed file from the chat footer.
 *
 * Both surfaces that list a turn's changed files — the inline pills and the
 * popover list — answer "which file did this turn change", so both open the
 * FILE, at its first changed line when the turn's tool parts still carry the
 * patch for that path. The diff view answers a different question ("what
 * changed") and stays reachable from the tool cards themselves.
 */
import type { TurnActivityRecord } from './lib/turns/types';
import { FILE_EDIT_TOOLS } from './changedFiles';
import { getFirstChangedLineFromMetadata } from './message/parts/toolDiffUtils';
import { toAbsoluteFilePath } from '@/lib/path-utils';
import type { RuntimeAPIs } from '@/lib/api/types';
import { useUIStore } from '@/stores/useUIStore';

/**
 * The line the file's own patch starts at, read from the turn's tool parts.
 * `TurnChangedFile` keeps only the counts, so the patch is looked up by path; a
 * path recorded in the turn diff without a matching part (a write made by a
 * delegated subagent, for instance) has no line and opens at the top.
 */
const findChangedFileLine = (
    activityParts: TurnActivityRecord[] | undefined,
    filePath: string,
): number | undefined => {
    if (!activityParts) return undefined;
    for (const activity of activityParts) {
        const part = activity.part;
        if (part.type !== 'tool') continue;
        if (!FILE_EDIT_TOOLS.has(part.tool)) continue;
        // SAFETY: the SDK's tool state carries the provider-specific `metadata`
        // the diff helpers read, and the state union does not declare it. The
        // helpers already accept it as an open record, so reading the same shape
        // here adds no narrowing the caller does not have — this is the shape
        // ToolPart and ProgressiveGroup read the same field with.
        const state = part.state as { metadata?: Record<string, unknown> } | undefined;
        const line = getFirstChangedLineFromMetadata(part.tool, state?.metadata, filePath);
        if (line !== undefined) return line;
    }
    return undefined;
};

interface OpenChangedFileOptions {
    /** Path of the file, relative to `directory`. */
    filePath: string;
    /** Working directory the relative path is resolved against. */
    directory: string | undefined;
    activityParts?: TurnActivityRecord[];
    runtime?: RuntimeAPIs;
    mobileActions?: { openFiles: () => void } | null;
}

/**
 * Opens `filePath` in the host editor. In VS Code the extension host opens its
 * own tab; elsewhere the workspace file view is asked to reveal the line, and
 * the mobile shell is told to surface that view.
 */
export const openChangedFile = ({
    filePath,
    directory,
    activityParts,
    runtime,
    mobileActions,
}: OpenChangedFileOptions): void => {
    if (!directory) return;
    const absolutePath = toAbsoluteFilePath(directory, filePath);
    const line = findChangedFileLine(activityParts, filePath);
    if (runtime?.editor && runtime.runtime.isVSCode) {
        void runtime.editor.openFile(absolutePath, line);
        return;
    }
    useUIStore.getState().openContextFileAtLine(directory, absolutePath, line ?? 1, 1);
    mobileActions?.openFiles();
};
