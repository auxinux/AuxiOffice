// Remplace @tauri-apps/api/path : chemins virtuels de « Mes fichiers ».

import { baseName, dirName, joinPath } from "../shared/http";

export const sep = () => "/";
export const delimiter = () => ":";
export const homeDir = async () => "/";
export const documentDir = async () => "/Documents";
export const downloadDir = async () => "/Documents";
export const desktopDir = async () => "/Documents";
export const tempDir = async () => "/.temp";
export const join = async (...parts: string[]) => joinPath(...parts);
export const resolve = async (...parts: string[]) => joinPath(...parts);
export const normalize = async (p: string) => joinPath(p);
export const basename = async (p: string, ext?: string) => {
  const b = baseName(p);
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
};
export const dirname = async (p: string) => dirName(p);
export const extname = async (p: string) => {
  const b = baseName(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1) : "";
};
export const isAbsolute = async (p: string) => p.startsWith("/");
