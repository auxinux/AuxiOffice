// Fil de travail : les opérations sur les PDF ne bloquent pas l'interface.
import { coreApi, type CoreApi } from "./api";

self.onmessage = async (ev: MessageEvent<{ id: number; fn: keyof CoreApi; args: unknown[] }>) => {
  const { id, fn, args } = ev.data;
  try {
    const f = coreApi[fn] as (...a: unknown[]) => Promise<unknown>;
    self.postMessage({ id, result: await f(...args) });
  } catch (e) {
    const err = e as Error & { code?: string };
    self.postMessage({ id, error: { message: err?.message ?? String(e), code: err?.code } });
  }
};
