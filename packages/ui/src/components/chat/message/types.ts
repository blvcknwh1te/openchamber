export type StreamPhase = 'streaming' | 'cooldown' | 'completed';

export type DiffViewMode = 'side-by-side' | 'unified';

/**
 * `metadata.tool` value marking popup content as Markdown source that must be
 * rendered as Markdown (tables and the like), not as highlighted code.
 */
export const MARKDOWN_POPUP_TOOL = 'markdown';

export interface AgentMentionInfo {
    name: string;
    token: string;
}

export interface ToolPopupContent {
    open: boolean;
    title: string;
    content: string;
    language?: string;
    isDiff?: boolean;
    diffHunks?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
    image?: {
        url: string;
        mimeType?: string;
        filename?: string;
        size?: number;
        gallery?: Array<{
            url: string;
            mimeType?: string;
            filename?: string;
            size?: number;
        }>;
        index?: number;
    };
    mermaid?: {
        url: string;
        mimeType?: string;
        filename?: string;
        source?: string;
    };
}

/**
 * Whether the tool output dialog has something to render for this request.
 * Images, diagrams, diffs and text bodies are renderable; a request carrying
 * none of them must not open the dialog.
 */
export const canRenderToolPopup = (popup: ToolPopupContent): boolean => Boolean(
    popup.image || popup.mermaid || popup.isDiff || popup.content,
);
