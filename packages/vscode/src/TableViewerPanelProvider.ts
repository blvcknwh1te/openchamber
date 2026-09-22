import * as vscode from 'vscode';
import { getThemeKindName } from './theme';
import { getWebviewShikiThemes } from './shikiThemes';
import { getWebviewHtml } from './webviewHtml';
import { resolveWebviewDevServerUrl } from './webviewDevServer';
import { resolveWorkspaceFolders } from './workspaceResolver';
import { normalizeWindowsDriveLetter } from './pathUtils';

const t = vscode.l10n.t;

/**
 * Opens a markdown table in an editor-area panel. The panel is static: it
 * renders the table the chat handed over and never connects to OpenCode, so it
 * carries no session state and every open table owns its own panel.
 */
export class TableViewerPanelProvider {
  public static readonly viewType = 'openchamberBnw.tableViewer';

  private readonly _panels = new Set<vscode.WebviewPanel>();
  private readonly _webviewDevServerUrl: string | null;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _extensionUri: vscode.Uri,
  ) {
    this._webviewDevServerUrl = resolveWebviewDevServerUrl(this._context);
  }

  public open(markdown: string): void {
    const distUri = vscode.Uri.joinPath(this._extensionUri, 'dist');
    const panel = vscode.window.createWebviewPanel(
      TableViewerPanelProvider.viewType,
      t('Table'),
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this._extensionUri, distUri],
      },
    );

    this._panels.add(panel);
    panel.onDidDispose(() => {
      this._panels.delete(panel);
    });

    panel.iconPath = {
      light: vscode.Uri.joinPath(this._extensionUri, 'assets', 'icon.svg'),
      dark: vscode.Uri.joinPath(this._extensionUri, 'assets', 'icon-titlebar.svg'),
    };

    panel.webview.html = this._getHtmlForWebview(panel.webview, markdown);
  }

  public updateTheme(kind: vscode.ColorThemeKind): void {
    const themeKind = getThemeKindName(kind);
    void getWebviewShikiThemes().then((shikiThemes) => {
      for (const panel of this._panels) {
        void panel.webview.postMessage({
          type: 'themeChange',
          theme: { kind: themeKind, shikiThemes },
        });
      }
    });
  }

  public postCustomAssets(assets: { themes: unknown[]; css: string }): void {
    for (const panel of this._panels) {
      void panel.webview.postMessage({ type: 'customAssets', themes: assets.themes, css: assets.css });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview, markdown: string): string {
    const workspaceFolder = normalizeWindowsDriveLetter(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
    );

    return getWebviewHtml({
      webview,
      extensionUri: this._extensionUri,
      workspaceFolder,
      workspaceFolders: resolveWorkspaceFolders(vscode.workspace.workspaceFolders ?? []),
      // The panel opens no OpenCode connection: the webview bootstrap dismisses
      // the splash by panel type instead of waiting for a connection status.
      initialStatus: 'connecting',
      cliAvailable: false,
      panelType: 'tableViewer',
      tableMarkdown: markdown,
      extensionVersion: String(this._context.extension?.packageJSON?.version || ''),
      devServerUrl: this._webviewDevServerUrl,
    });
  }
}
