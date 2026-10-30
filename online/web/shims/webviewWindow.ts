// Remplace @tauri-apps/api/webviewWindow : une page = une fenêtre.

import { getCurrentWindow } from "./window";

export const getCurrentWebviewWindow = getCurrentWindow;
/** Les autres onglets du navigateur ne sont pas visibles d'ici. */
export const getAllWebviewWindows = async () => [] as ReturnType<typeof getCurrentWindow>[];
