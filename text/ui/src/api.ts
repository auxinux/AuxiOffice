// Appels à la coque Rust (lib.rs).

import { invoke } from "@tauri-apps/api/core";
import type { Eol } from "./encodings";

export interface Stat {
  exists: boolean;
  mtime: number;
  size: number;
}

export interface Opened {
  text: string;
  encoding: string;
  bom: boolean;
  eol: Eol;
  mixed_eol: boolean;
  lossy: boolean;
  stat: Stat;
  readonly: boolean;
}

/** Erreur de la coque : `code` = notfound, permission, folder, binary, large, huge, unmappable, encoding, io. */
export interface TextError {
  code: string;
  message: string;
  size?: number;
  ch?: string;
  line?: number;
}

export function asTextError(e: unknown): TextError {
  if (e && typeof e === "object" && "code" in e && "message" in e) return e as TextError;
  return { code: "io", message: String(e) };
}

export interface AppInfo {
  version: string;
  writer: boolean;
  platform: string;
}

export const api = {
  readText: (path: string, encoding?: string, force?: boolean) => invoke<Opened>("read_text", { path, encoding: encoding ?? null, force: force ?? false }),
  writeText: (path: string, text: string, encoding: string, bom: boolean, eol: Eol) => invoke<Stat>("write_text", { path, text, encoding, bom, eol }),
  statFiles: (paths: string[]) => invoke<Stat[]>("stat_files", { paths }),
  prefsLoad: () => invoke<unknown>("prefs_load"),
  prefsSave: (prefs: unknown) => invoke<void>("prefs_save", { prefs }),
  recent: (args: { add?: string; remove?: string; clear?: boolean } = {}) => invoke<string[]>("recent_files", { add: args.add ?? null, remove: args.remove ?? null, clear: args.clear ?? null }),
  takeLaunches: () => invoke<string[]>("take_launches"),
  newWindow: (files: string[] = []) => invoke<void>("new_window", { files }),
  openInWriter: (path: string) => invoke<void>("open_in_writer", { path }),
  appInfo: () => invoke<AppInfo>("app_info"),
  systemTheme: () => invoke<"dark" | "light" | null>("system_theme"),
  printPage: () => invoke<void>("print_page"),
};
