// Remplace @tauri-apps/api/event : événements de la page (rappels des
// moteurs reçus par WebSocket, relayés sous le nom « engine »).

export type UnlistenFn = () => void;
export interface Event<T> {
  event: string;
  id: number;
  payload: T;
}
type Handler = (e: Event<never>) => void;

const handlers = new Map<string, Set<Handler>>();
let seq = 0;

export function dispatch(event: string, payload: unknown) {
  for (const h of handlers.get(event) ?? []) h({ event, id: ++seq, payload: payload as never });
}

export async function listen<T>(event: string, handler: (e: Event<T>) => void): Promise<UnlistenFn> {
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  const h = handler as Handler;
  set.add(h);
  return () => void set.delete(h);
}

export async function once<T>(event: string, handler: (e: Event<T>) => void): Promise<UnlistenFn> {
  const un = await listen<T>(event, (e) => {
    un();
    handler(e);
  });
  return un;
}

export async function emit(event: string, payload?: unknown) {
  dispatch(event, payload);
}

export async function emitTo(_target: unknown, event: string, payload?: unknown) {
  dispatch(event, payload);
}
