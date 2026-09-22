declare global {
  interface Window {
    __OPENCHAMBER_VSCODE_SHIKI_THEMES__?: {
      light?: Record<string, unknown>;
      dark?: Record<string, unknown>;
    } | null;
    /** Markdown table handed over by the extension host for the table viewer panel. */
    __OPENCHAMBER_TABLE_MARKDOWN__?: string | null;
  }
}

export {};

