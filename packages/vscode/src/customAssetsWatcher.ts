import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { readCustomCssForInjection, readCustomThemesForInjection } from './webviewHtml';

export type CustomAssets = { themes: unknown[]; css: string };

const DEBOUNCE_MS = 250;

// [OC-PATCH: custom-assets-live] Watch ~/.config/openchamber/themes/*.json and
// custom.css; on any change re-read both and notify (the extension broadcasts
// to every webview, which applies them without a reload).
export class CustomAssetsWatcher {
  private readonly watchers: vscode.FileSystemWatcher[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onChange: (assets: CustomAssets) => void,
  ) {}

  start(): void {
    const base = path.join(os.homedir(), '.config', 'openchamber');
    const patterns = [
      new vscode.RelativePattern(path.join(base, 'themes'), '*.json'),
      new vscode.RelativePattern(base, 'custom.css'),
    ];
    const fire = () => {
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.onChange({ themes: readCustomThemesForInjection(), css: readCustomCssForInjection() });
      }, DEBOUNCE_MS);
    };
    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidCreate(fire);
      watcher.onDidChange(fire);
      watcher.onDidDelete(fire);
      this.watchers.push(watcher);
      this.context.subscriptions.push(watcher);
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers.length = 0;
  }
}
