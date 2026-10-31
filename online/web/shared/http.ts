// Appels à l'API HTTP du serveur (auxi-online).

/** En-tête exigé par le serveur pour toute modification (protection CSRF). */
const MUTATE = { "x-auxi": "1" };

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Adresse de la page à son ouverture (avant que l'application ne la nettoie). */
const initialUrl = location.pathname + location.search;

/** Session expirée : retour au portail, qui affiche la connexion puis revient ici. */
function expired() {
  if (location.pathname === "/" || location.pathname === "/index.html") return;
  location.href = `/?retour=${encodeURIComponent(initialUrl)}`;
}

async function check(r: Response): Promise<Response> {
  if (r.ok) return r;
  let msg = `${r.status} ${r.statusText}`;
  try {
    const j = await r.json();
    if (j?.error) msg = j.error;
  } catch {
    /* corps non JSON */
  }
  if (r.status === 401) expired();
  throw new HttpError(r.status, msg);
}

export async function getJson<T>(url: string): Promise<T> {
  return (await check(await fetch(url, { credentials: "same-origin" }))).json();
}

export async function postJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  const r = await fetch(url, { method, credentials: "same-origin", headers: { ...MUTATE, "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await check(r)).json();
}

export interface Entry {
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
}

export interface Stat {
  exists: boolean;
  mtime: number;
  size: number;
}

/** Remarque d'AuxiCorrect (positions en unités UTF-16, comme les chaînes JavaScript). */
export interface Remark {
  from: number;
  to: number;
  category: string;
  severity: string;
  message: string;
  suggestions: string[];
  rule: string;
}

export interface Account {
  email: string;
  name: string;
  admin: boolean;
  quota_mb: number;
  custom_quota: boolean;
  used: number;
  files: number;
  mail: number;
  plan: string;
  plan_name: string;
}

export interface AcOptions {
  enabled: boolean;
  international: boolean;
  variant: string;
  style: boolean;
  regional: boolean;
}

export interface Plan {
  id: string;
  name: string;
  quota_mb: number;
}

export interface Settings {
  plans: Plan[];
  default_plan: string;
  default_quota_mb: number;
  max_docs_per_user: number;
  idle_minutes: number;
  auximail_url: string;
}

export interface Status {
  version: string;
  uptime_s: number;
  accounts: number;
  storage: number;
  engines_running: number;
  engines_max: number;
  docs_open: number;
  spares: number;
  sandbox: string;
  auxicorrect: { cli: string; version: string | null } | null;
  max_open_mb: number;
  auximail: { ok: boolean; version?: string; mode?: string; openSpaces?: number; error?: string } | null;
}

export interface Me {
  auth: boolean;
  version: string;
  /** Adresse d'AuxiMail (vide : pas encore offert). */
  auximail?: string;
  auxicorrect?: boolean;
  user?: { email: string; name: string; admin?: boolean };
  usage?: { used: number; quota: number; files: number; mail: number; available: number; plan: { id: string; name: string } };
}

const q = (path: string) => `path=${encodeURIComponent(path)}`;

export const files = {
  me: async (): Promise<Me> => {
    const r = await fetch("/api/me", { credentials: "same-origin" });
    return r.json();
  },
  login: (email: string, password: string) => postJson<{ user: { email: string; name: string } }>("/api/login", { email, password }),
  logout: () => postJson("/api/logout", {}),
  list: (path: string) => getJson<{ path: string; entries: Entry[] }>(`/api/files?${q(path)}`),
  read: async (path: string): Promise<ArrayBuffer> => (await check(await fetch(`/api/file?${q(path)}`, { credentials: "same-origin" }))).arrayBuffer(),
  url: (path: string, download = false) => `/api/file?${q(path)}${download ? "&download=1" : ""}`,
  write: async (path: string, body: BodyInit): Promise<Stat> => {
    const r = await fetch(`/api/file?${q(path)}`, { method: "PUT", credentials: "same-origin", headers: MUTATE, body });
    return (await check(r)).json();
  },
  stat: (paths: string[]) => postJson<Stat[]>("/api/stat", { paths }),
  mkdir: (path: string) => postJson("/api/mkdir", { path }),
  move: (from: string, to: string) => postJson("/api/move", { from, to }),
  remove: (path: string) => postJson("/api/delete", { path }),
  newDocument: (kind: string) => postJson<{ path: string }>("/api/new", { kind }),
  kvGet: <T>(name: string) => getJson<T | null>(`/api/kv/${name}`),
  kvPut: (name: string, value: unknown) => postJson(`/api/kv/${name}`, value, "PUT"),
  changePassword: (old: string, next: string) => postJson("/api/me/password", { old, new: next }),
  adminUsers: () => getJson<{ users: Account[]; default_quota_mb: number; plans: Plan[]; default_plan: string; mail_counted: boolean }>("/api/admin/users"),
  adminAdd: (a: { email: string; name: string; password: string; admin: boolean; quota_mb?: number; plan?: string }) => postJson("/api/admin/users", a),
  adminUpdate: (a: { email: string; name?: string; password?: string; admin?: boolean; quota_mb?: number; plan?: string }) => postJson("/api/admin/users/update", a),
  adminDelete: (email: string, withFiles: boolean) => postJson("/api/admin/users/delete", { email, files: withFiles }),
  auxicorrect: () => getJson<{ available: boolean; version: string | null; options: AcOptions }>("/api/auxicorrect"),
  setAuxicorrect: (o: AcOptions) => postJson<{ available: boolean; version: string | null; options: AcOptions }>("/api/auxicorrect", o, "PUT"),
  lookup: (what: string, word: string) => postJson<{ text: string }>("/api/auxicorrect/lookup", { what, word }),
  check: (text: string, international: boolean) => postJson<Remark[]>("/api/auxicorrect/check", { text, international }),
  setProfile: (name: string) => postJson("/api/me/profile", { name }),
  settings: () => getJson<Settings>("/api/admin/settings"),
  setSettings: (s: Settings) => postJson<Settings>("/api/admin/settings", s, "PUT"),
  status: () => getJson<Status>("/api/admin/status"),
  log: (message: string) => void fetch("/api/log", { method: "POST", credentials: "same-origin", headers: MUTATE, body: message }).catch(() => undefined),
};

// --- Chemins virtuels -----------------------------------------------------------

export function baseName(p: string): string {
  return p.split("/").pop() ?? p;
}

export function dirName(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

export function joinPath(...parts: string[]): string {
  const out: string[] = [];
  for (const part of parts) for (const c of part.split("/")) if (c && c !== ".") c === ".." ? out.pop() : out.push(c);
  return "/" + out.join("/");
}

/** Nom libre dans le dossier : « nom (2).ext », « nom (3).ext »… */
export async function freeName(dir: string, name: string): Promise<string> {
  const taken = new Set((await files.list(dir).catch(() => ({ entries: [] as Entry[] }))).entries.map((e) => e.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return joinPath(dir, name);
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let i = 2; ; i++) {
    const n = `${stem} (${i})${ext}`;
    if (!taken.has(n.toLowerCase())) return joinPath(dir, n);
  }
}

/** Fichiers de l'ordinateur envoyés dans un dossier ; retourne leurs chemins. */
export async function upload(dir: string, list: FileList | File[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of Array.from(list)) {
    const target = await freeName(dir, f.name);
    await files.write(target, f);
    out.push(target);
  }
  return out;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0).replace(".", ",")} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
  return `${(n / 1024 ** 3).toFixed(1).replace(".", ",")} Go`;
}
