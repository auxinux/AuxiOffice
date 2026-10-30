// Remplace @tauri-apps/api/app.

import { files } from "../shared/http";

let version: Promise<string> | null = null;

export function getVersion(): Promise<string> {
  version ??= files.me().then((m) => m.version ?? "", () => "");
  return version;
}

export const getName = async () => "AuxiOffice Online";
export const getTauriVersion = async () => "";
