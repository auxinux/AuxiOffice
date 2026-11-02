// Appels à la coque Rust (lib.rs).
import { invoke } from "@tauri-apps/api/core";

export interface Printer {
  name: string;
  default: boolean;
}

export interface Prefs {
  format?: string;
  landscape?: boolean;
}

const raw = (b: Uint8Array) => b as unknown as ArrayBuffer;
const bytesOf = (r: unknown) => new Uint8Array(r as ArrayBuffer);

export const api = {
  readFile: async (path: string) => bytesOf(await invoke("read_file", { path })),
  writePdf: (path: string, bytes: Uint8Array) => invoke<string>("write_pdf", raw(bytes), { headers: { "x-path": encodeURIComponent(path) } }),
  writeTemp: (name: string, bytes: Uint8Array) => invoke<string>("write_temp", raw(bytes), { headers: { "x-name": encodeURIComponent(name) } }),
  fileInfo: (path: string) => invoke<{ exists: boolean; readonly?: boolean; size?: number }>("file_info", { path }),
  decrypt: async (bytes: Uint8Array, password: string) => bytesOf(await invoke("pdf_decrypt", raw(bytes), { headers: { "x-password": encodeURIComponent(password) } })),
  encrypt: async (bytes: Uint8Array, password: string) => bytesOf(await invoke("pdf_encrypt", raw(bytes), { headers: { "x-password": encodeURIComponent(password) } })),
  printers: () => invoke<Printer[]>("printers"),
  printFile: (path: string, options: { printer: string; copies: number; pages: string }) => invoke<string>("print_file", { path, options }),
  openSystem: (target: string) => invoke<void>("open_system", { target }),
  prefsLoad: () => invoke<Prefs>("prefs_load"),
  prefsSave: (prefs: Prefs) => invoke<void>("prefs_save", { prefs }),
  recent: (args: { add?: string; remove?: string } = {}) => invoke<string[]>("recent_files", { add: args.add ?? null, remove: args.remove ?? null }),
  takeLaunches: () => invoke<string[]>("take_launches"),
  newWindow: (files: string[] = []) => invoke<void>("new_window", { files }),
  appInfo: () => invoke<{ version: string; platform: string }>("app_info"),
  systemTheme: () => invoke<"dark" | "light" | null>("system_theme"),
};

export const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
export const dirName = (p: string) => p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")));
export const isPdf = (p: string) => /\.pdf$/i.test(p);
export const isImage = (p: string) => /\.(png|jpe?g|webp|bmp|gif)$/i.test(p);
