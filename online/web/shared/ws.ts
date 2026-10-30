// Canal WebSocket vers les moteurs de documents du serveur.
//
// Requêtes numérotées ; réponses JSON ou trames binaires (tuiles) :
// numéro (u32 petit-boutiste), format (0 brut, 1 zlib), octets RGBA.
// Les tuiles compressées sont décompressées ici, par le navigateur.
//
// Coupure (Wi-Fi, mise en veille, redémarrage du mandataire) : les moteurs
// restent ouverts sur le serveur quelques minutes ; on se reconnecte à la
// même session (`?resume=`) et les documents reprennent sans rien perdre.

import { toast } from "./dialogs";

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
type EventFn = (payload: Record<string, unknown>) => void;

let socket: WebSocket | null = null;
let opening: Promise<WebSocket> | null = null;
let next = 1;
const pending = new Map<number, Pending>();
const openDocs = new Set<number>();
const eventFns = new Set<EventFn>();
let heartbeat = 0;
/** Session du serveur (reprise après une coupure). */
let session: string | null = null;
/** Coupure en cours : début, pour abandonner après le délai du serveur. */
let lostAt = 0;
const RESUME_MS = 170_000;

export function onEngineEvent(fn: EventFn): () => void {
  eventFns.add(fn);
  return () => eventFns.delete(fn);
}

function emit(payload: Record<string, unknown>) {
  for (const fn of eventFns) fn(payload);
}

async function inflate(data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Response(stream).arrayBuffer();
}

/** Documents perdus pour de bon : l'interface propose de les rouvrir. */
function loseDocs(ids: Iterable<number>) {
  for (const doc of [...ids]) {
    openDocs.delete(doc);
    emit({ doc, event: "engine_exited" });
  }
}

function connect(): Promise<WebSocket> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  if (opening) return opening;
  const resume = session && openDocs.size ? `?resume=${encodeURIComponent(session)}` : "";
  opening = new Promise((resolve, reject) => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${resume}`);
    ws.binaryType = "arraybuffer";
    let greeted = false;
    ws.onerror = () => {
      if (!greeted && opening) {
        opening = null;
        reject(new Error("Connexion au serveur impossible."));
      }
    };
    ws.onclose = () => {
      clearInterval(heartbeat);
      if (socket === ws) socket = null;
      for (const p of pending.values()) p.reject(new Error("Connexion au serveur perdue."));
      pending.clear();
      if (!greeted) {
        // Refusée avant le message d'accueil (session expirée, serveur arrêté).
        if (opening) {
          opening = null;
          reject(new Error("Connexion au serveur impossible."));
        }
        return;
      }
      if (openDocs.size) reconnectLater();
    };
    ws.onmessage = (m) => {
      if (typeof m.data === "string") {
        const v = JSON.parse(m.data);
        if (v.event === "hello") {
          greeted = true;
          const kept = new Set<number>(v.docs ?? []);
          if (resume) {
            loseDocs([...openDocs].filter((d) => !kept.has(d)));
            if (lostAt) toast("Connexion rétablie : vos documents sont intacts.", 3500);
          } else if (openDocs.size) loseDocs(openDocs);
          lostAt = 0;
          session = v.session;
          socket = ws;
          opening = null;
          clearInterval(heartbeat);
          // Garde la connexion ouverte derrière un mandataire (nginx coupe après 60 s de silence).
          heartbeat = window.setInterval(() => void request("ping").catch(() => undefined), 25_000);
          resolve(ws);
          return;
        }
        if (v.event === "engine") {
          if (v.payload?.event === "engine_exited") openDocs.delete(v.payload.doc);
          return emit(v.payload);
        }
        const p = pending.get(v.id);
        if (!p) return;
        pending.delete(v.id);
        if (v.ok) p.resolve(v.result);
        else p.reject(v.error ?? "erreur du serveur");
        return;
      }
      const buf = new Uint8Array(m.data as ArrayBuffer);
      const id = new DataView(buf.buffer).getUint32(0, true);
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      const body = buf.subarray(5);
      if (buf[4] === 1) inflate(body).then(p.resolve, p.reject);
      else p.resolve(body.slice().buffer);
    };
  });
  return opening;
}

let retry = 0;

/** Reconnexion après une coupure, tant que le serveur garde les documents. */
function reconnectLater() {
  if (retry) return;
  if (!lostAt) {
    lostAt = Date.now();
    toast("Connexion au serveur perdue : reconnexion en cours…", 5000);
  }
  const attempt = () => {
    retry = 0;
    if (!openDocs.size) return;
    if (Date.now() - lostAt > RESUME_MS) {
      toast("Impossible de joindre le serveur : les documents ouverts sont fermés.", 8000);
      loseDocs(openDocs);
      lostAt = 0;
      return;
    }
    connect().catch(() => {
      retry = window.setTimeout(attempt, 2000);
    });
  };
  retry = window.setTimeout(attempt, 1000);
}

window.addEventListener("online", () => {
  if (lostAt && !socket) {
    clearTimeout(retry);
    retry = 0;
    void connect().catch(() => reconnectLater());
  }
});

export async function request<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const ws = await connect();
  const id = next++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    ws.send(JSON.stringify({ id, cmd, ...args }));
  });
}

export async function openDoc<T extends { doc: number }>(args: Record<string, unknown>): Promise<T> {
  const info = await request<T>("doc_open", args);
  openDocs.add(info.doc);
  return info;
}

export async function closeDoc(doc: number) {
  openDocs.delete(doc);
  await request("doc_close", { doc });
}
