import * as os from 'os';
import * as path from 'path';

// [OC-PATCH: custom-css] Single owner for the user-level OpenChamber asset
// locations. The webview HTML injection, the live assets watcher, and the
// Settings actions must resolve to the same files, so none of them builds the
// path itself.
export const OPENCHAMBER_USER_CONFIG_DIR = path.join(os.homedir(), '.config', 'openchamber');
export const OPENCHAMBER_THEMES_DIR = path.join(OPENCHAMBER_USER_CONFIG_DIR, 'themes');
export const OPENCHAMBER_CUSTOM_CSS_PATH = path.join(OPENCHAMBER_USER_CONFIG_DIR, 'custom.css');
