// Appels au fil de travail, sous la forme de fonctions asynchrones ordinaires.
import type { CoreApi } from "./api";

export class CoreCallError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const pending = new Map<number, { ok: (v: unknown) => void; ko: (e: unknown) => void }>();
let nextId = 0;

worker.onmessage = (ev: MessageEvent<{ id: number; result?: unknown; error?: { message: string; code?: string } }>) => {
  const p = pending.get(ev.data.id);
  if (!p) return;
  pending.delete(ev.data.id);
  if (ev.data.error) p.ko(new CoreCallError(ev.data.error.message, ev.data.error.code));
  else p.ok(ev.data.result);
};

export function core<K extends keyof CoreApi>(fn: K, ...args: Parameters<CoreApi[K]>): Promise<Awaited<ReturnType<CoreApi[K]>>> {
  const id = ++nextId;
  return new Promise((ok, ko) => {
    pending.set(id, { ok: ok as (v: unknown) => void, ko });
    worker.postMessage({ id, fn, args });
  });
}
