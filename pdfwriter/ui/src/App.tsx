// AuxiPDFWriter : une fenêtre, un document. Cet élément tient l'état du document
// (octets, pages, objets ajoutés, historique) et toutes les commandes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api, dirName, fileName, isImage, isPdf, joinPath, type Prefs } from "./api";
import { core, CoreCallError } from "./core/client";
import type { Align, FontFamily, ImageObj, PageObject, TextObj } from "./core/objects";
import { everyN, type Metadata, type PageSpec, parseRanges, type Rgb } from "./core/pages";
import type { RunEdit, TextRun } from "./core/textedit";
import * as D from "./Dialogs";
import { Icon } from "./icons";
import { imageUrl, normalizeImage } from "./images";
import { activateMenu, BROWSER_KEYS, installMenu, IS_WINDOWS, keyName, shortcuts } from "./menus";
import { applyOrder, type DocState, History, initialState, insertPagesAt, isIdentity, moveOrder, newId, objectsByIndex, touchPages } from "./model";
import { documentOptions, loadPdfjs, type PdfLib } from "./pdfjs";
import { Thumbs } from "./Thumbs";
import { type Tool, Viewer, type ViewerHandle, type ToolStyle } from "./Viewer";

const PDF_FILTER = [{ name: "Documents PDF", extensions: ["pdf"] }];
const IMAGE_FILTER = [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] }];

type DialogState =
  | { kind: "new" | "blank" | "merge" | "split" | "extract" | "numbers" | "watermark" | "crop" | "print" | "protect" | "about" }
  | { kind: "metadata"; initial: Metadata };

interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  url: string | null;
  items: OutlineItem[];
}

const TOOLS: { id: Tool; icon: string; title: string }[] = [
  { id: "select", icon: "pointer", title: "Sélection : déplacer et modifier les objets ajoutés" },
  { id: "editText", icon: "editText", title: "Modifier le texte du document (Ctrl+E)" },
  { id: "text", icon: "text", title: "Ajouter une zone de texte (Ctrl+T)" },
  { id: "rect", icon: "rect", title: "Rectangle" },
  { id: "ellipse", icon: "ellipse", title: "Ellipse" },
  { id: "line", icon: "line", title: "Ligne" },
  { id: "highlight", icon: "highlight", title: "Surligner" },
  { id: "whiteout", icon: "whiteout", title: "Masque blanc : cache visuellement ; le contenu reste dans le fichier" },
];

const message = (e: unknown) => (e as Error)?.message ?? String(e);

interface Probe {
  count: number;
  password?: string;
  encrypted: boolean;
  restricted: boolean;
}

export default function App() {
  const viewer = useRef<ViewerHandle>(null);
  const history = useRef(new History());
  const [doc, setDocState] = useState<DocState | null>(null);
  const docRef = useRef(doc);
  const savedRef = useRef<DocState | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [protect, setProtect] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState<string | null>(null);
  const [viewPassword, setViewPassword] = useState<string | undefined>();
  const [formDirty, setFormDirty] = useState(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<{ id: string; uid: string } | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [sidebar, setSidebar] = useState<"pages" | "outline" | null>("pages");
  const [current, setCurrent] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState({ scale: 1, preset: "auto" });
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [found, setFound] = useState({ current: 0, total: 0, notFound: false });
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [passwordAsk, setPasswordAsk] = useState<{ retry: boolean; resolve: (p: string | null) => void } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; buttons: { id: string; label: string; primary?: boolean }[]; resolve: (id: string | null) => void } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [version, setVersion] = useState("");
  const [, setRecent] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<string>("");
  const prefsRef = useRef<Prefs>({});
  const clipboard = useRef<PageObject | null>(null);
  const closing = useRef(false);
  const [style, setStyle] = useState<ToolStyle>({ color: [0, 0, 0], fill: null, strokeWidth: 1.5, opacity: 1, highlight: [1, 0.92, 0.3], family: "Helvetica", size: 14, bold: false, italic: false, align: "left" });

  const setDoc = (s: DocState | null) => {
    docRef.current = s;
    setDocState(s);
  };
  const canEdit = !!doc && !readOnly;
  const dirty = !!doc && !readOnly && (doc !== savedRef.current || formDirty);
  const pristine = !doc || (!path && !dirty && history.current.undoList.length === 0 && !readOnly);

  const say = useCallback((text: string, error = false) => {
    setNote({ text, error });
    if (!error) window.setTimeout(() => setNote((n) => (n?.text === text ? null : n)), 5000);
  }, []);

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      say(message(e), true);
    } finally {
      setBusy(null);
    }
  }, [say]);

  const ask = (title: string, text: string, buttons: { id: string; label: string; primary?: boolean }[]) =>
    new Promise<string | null>((resolve) => setConfirm({ title, text, buttons, resolve }));

  // --- Modifications --------------------------------------------------------------

  const commit = useCallback((next: DocState) => {
    const cur = docRef.current;
    if (cur) history.current.push(cur);
    setDoc(next);
    setFormDirty(false);
  }, []);

  /** Octets courants, champs de formulaire remplis compris. */
  const base = useCallback(async () => {
    const d = docRef.current!;
    return (await viewer.current?.commitForms(d.bytes)) ?? d.bytes;
  }, []);

  const pageIndices = useCallback(() => {
    const d = docRef.current!;
    const sel = d.pages.flatMap((p, i) => (selection.has(p.uid) ? [i] : []));
    return sel.length ? sel : [current - 1];
  }, [selection, current]);

  const undo = () => {
    const d = docRef.current;
    if (!d) return;
    const s = history.current.undo(d);
    if (s) {
      setDoc(s);
      setSelected(null);
      setFormDirty(false);
    }
  };
  const redo = () => {
    const d = docRef.current;
    if (!d) return;
    const s = history.current.redo(d);
    if (s) {
      setDoc(s);
      setSelected(null);
      setFormDirty(false);
    }
  };

  const reorder = (order: number[], label: string) =>
    run(label, async () => {
      const d = docRef.current!;
      if (isIdentity(order, d.pages.length)) return;
      commit(applyOrder(d, order, await core("rearrange", await base(), order)));
    });

  // --- Ouverture ---------------------------------------------------------------------

  const askPassword = (retry: boolean) => new Promise<string | null>((resolve) => setPasswordAsk({ retry, resolve }));

  /** Lit le document une première fois : nombre de pages, mot de passe, droits. */
  const probe = async (data: Uint8Array): Promise<Probe> => {
    const { lib } = await loadPdfjs();
    const task = lib.getDocument(documentOptions(data));
    let used: string | undefined;
    let cancelled = false;
    task.onPassword = (update: (p: string) => void, reason: number) => {
      void askPassword(reason === lib.PasswordResponses.INCORRECT_PASSWORD).then((p) => {
        setPasswordAsk(null);
        if (p === null) {
          cancelled = true;
          void task.destroy();
        } else {
          used = p;
          update(p);
        }
      });
    };
    try {
      const d = await task.promise;
      const perms = (await d.getPermissions().catch(() => null)) as number[] | Set<number> | null;
      const has = (f: number) => (Array.isArray(perms) ? perms.includes(f) : perms!.has(f));
      const restricted = !!perms && !has(lib.PermissionFlag.MODIFY_CONTENTS);
      let encrypted = false;
      await core("getMetadata", data).catch((e: CoreCallError) => {
        if (e.code === "encrypted") encrypted = true;
        else throw e;
      });
      const r = { count: d.numPages, password: used, encrypted, restricted };
      void task.destroy();
      return r;
    } catch (e) {
      if (cancelled) throw new Error("Ouverture annulée : mot de passe non fourni.");
      void task.destroy();
      throw e;
    }
  };

  const adopt = (bytes: Uint8Array, count: number, p: string | null, prot: string | null, ro: string | null, viewPw?: string) => {
    history.current.clear();
    const s = initialState(bytes, count);
    savedRef.current = s;
    setPdf(null);
    setSelected(null);
    setSelection(new Set());
    setPath(p);
    setProtect(prot);
    setReadOnly(ro);
    setViewPassword(viewPw);
    setFormDirty(false);
    setFatal(null);
    setDoc(s);
    setSidebar("pages");
    setTool("select");
  };

  const loadPath = useCallback(async (p: string) => {
    let data: Uint8Array;
    try {
      data = await api.readFile(p);
    } catch (e) {
      await api.recent({ remove: p }).then(setRecent);
      throw e;
    }
    let info: Probe | null = null;
    let invalid: string | null = null;
    try {
      info = await probe(data);
    } catch (e) {
      if (/annulée/.test(message(e))) throw e;
      invalid = message(e);
    }
    if (invalid || !info) {
      // PDF.js ne sait pas le lire, ou pdf-lib ne saurait pas le modifier.
      const { lib } = await loadPdfjs();
      const task = lib.getDocument(documentOptions(data));
      task.onPassword = () => void task.destroy();
      const d = await task.promise.catch(() => null);
      if (!d) throw new Error(`${fileName(p)} n'est pas un document PDF lisible.`);
      const count = d.numPages;
      void task.destroy();
      adopt(data, count, p, null, `Ce PDF peut être lu, mais pas modifié (${invalid}).`);
    } else if (info.encrypted && info.restricted) {
      adopt(data, info.count, p, null, "L'auteur a interdit la modification de ce document : il s'ouvre en lecture seule.", info.password);
    } else if (info.encrypted) {
      const plain = await api.decrypt(data, info.password ?? "");
      adopt(plain, info.count, p, info.password ?? null, null);
    } else {
      adopt(data, info.count, p, null, null);
    }
    setRecent(await api.recent({ add: p }));
  }, []);

  const openFiles = useCallback(async (paths: string[]) => {
    const pdfs = paths.filter(isPdf);
    if (!pdfs.length) return;
    let rest = pdfs;
    if (pristine) {
      await run("Ouverture…", () => loadPath(pdfs[0]));
      rest = pdfs.slice(1);
    }
    for (const f of rest) await api.newWindow([f]);
  }, [pristine, loadPath, run]);

  const pickOpen = async () => {
    const r = await openDialog({ multiple: true, filters: PDF_FILTER });
    if (r) await openFiles(Array.isArray(r) ? r : [r]);
  };

  const createFromImages = useCallback(async (files: string[]) => {
    const images = [];
    for (const f of files) {
      const im = await normalizeImage(await api.readFile(f), f);
      images.push({ bytes: im.bytes, mime: im.mime });
    }
    const bytes = await core("imagesToPdf", images, "fit", 0);
    const s = initialState(bytes, images.length);
    history.current.clear();
    savedRef.current = null;
    setPath(null);
    setProtect(null);
    setReadOnly(null);
    setDoc(s);
  }, []);

  const specOf = (): PageSpec => ({ format: prefsRef.current.format ?? "letter", landscape: !!prefsRef.current.landscape });

  const startBlank = useCallback(async () => {
    adopt(await core("createBlank", specOf(), 1), 1, null, null, null);
  }, []);

  // Démarrage : le fichier reçu, sinon un document vierge.
  useEffect(() => {
    void (async () => {
      prefsRef.current = await api.prefsLoad().catch(() => ({}));
      const theme = await api.systemTheme().catch(() => null);
      if (theme) document.documentElement.dataset.theme = theme;
      setVersion((await api.appInfo()).version);
      setRecent(await api.recent());
      const files = await api.takeLaunches();
      const images = files.filter(isImage);
      const pdfs = files.filter(isPdf);
      try {
        if (images.length) {
          await createFromImages(images);
        } else if (pdfs.length) {
          await loadPath(pdfs[0]);
          for (const f of pdfs.slice(1)) await api.newWindow([f]);
        } else {
          await startBlank();
        }
      } catch (e) {
        if (files.length) say(message(e), true);
        await startBlank();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Enregistrement --------------------------------------------------------------------

  const finalBytes = async () => {
    const d = docRef.current!;
    const b = await base();
    return { flat: await core("flatten", b, objectsByIndex({ ...d, bytes: b })), base: b };
  };

  const writeTo = async (target: string) => {
    const d = docRef.current!;
    const { flat, base: b } = await finalBytes();
    await api.writePdf(target, protect ? await api.encrypt(flat, protect) : flat);
    const next = b === d.bytes ? d : { ...d, bytes: b };
    if (next !== d) setDoc(next);
    savedRef.current = next;
    setFormDirty(false);
    setPath(target);
    setRecent(await api.recent({ add: target }));
    say(`Enregistré : ${fileName(target)}${protect ? " (protégé par mot de passe)" : ""}`);
  };

  const saveAs = async (): Promise<boolean> => {
    const t = await saveDialog({ defaultPath: path ?? "Sans titre.pdf", filters: PDF_FILTER });
    if (!t) return false;
    let ok = false;
    await run("Enregistrement…", async () => {
      await writeTo(/\.pdf$/i.test(t) ? t : `${t}.pdf`);
      ok = true;
    });
    return ok;
  };

  const save = async (): Promise<boolean> => {
    if (readOnly) return false;
    if (!path) return saveAs();
    const info = await api.fileInfo(path);
    if (info.exists && info.readonly) {
      say("Ce fichier est en lecture seule : choisissez un autre nom.");
      return saveAs();
    }
    let ok = false;
    await run("Enregistrement…", async () => {
      await writeTo(path);
      ok = true;
    });
    return ok;
  };

  /** Nouveau fichier produit par une commande : enregistré puis ouvert. */
  const deliver = async (bytes: Uint8Array, suggested: string) => {
    const t = await saveDialog({ defaultPath: dirName(path ?? "") ? joinPath(dirName(path!), suggested) : suggested, filters: PDF_FILTER });
    if (!t) return;
    const target = /\.pdf$/i.test(t) ? t : `${t}.pdf`;
    await api.writePdf(target, bytes);
    if (pristine) await loadPath(target);
    else await api.newWindow([target]);
    say(`Créé : ${fileName(target)}`);
  };

  const close = useCallback(async () => {
    const w = getCurrentWindow();
    if (docRef.current && !readOnly && (docRef.current !== savedRef.current || formDirty)) {
      const c = await ask("Enregistrer les modifications ?", `« ${path ? fileName(path) : "Sans titre.pdf"} » a des modifications non enregistrées.`, [
        { id: "discard", label: "Ne pas enregistrer" },
        { id: "cancel", label: "Annuler" },
        { id: "save", label: "Enregistrer", primary: true },
      ]);
      if (c === "cancel" || c === null) return;
      if (c === "save" && !(await save())) return;
    }
    closing.current = true;
    await w.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, readOnly, formDirty, protect]);

  // --- Objets ---------------------------------------------------------------------------------

  const addObject = (uid: string, o: PageObject) => {
    const d = docRef.current!;
    commit({ ...d, objects: { ...d.objects, [uid]: [...(d.objects[uid] ?? []), o] } });
    setSelected({ id: o.id, uid });
  };
  const removeObject = (uid: string, id: string) => {
    const d = docRef.current!;
    commit({ ...d, objects: { ...d.objects, [uid]: (d.objects[uid] ?? []).filter((x) => x.id !== id) } });
    setSelected((s) => (s?.id === id ? null : s));
  };
  const changeObject = (uid: string, o: PageObject) => {
    const d = docRef.current!;
    commit({ ...d, objects: { ...d.objects, [uid]: (d.objects[uid] ?? []).map((x) => (x.id === o.id ? o : x)) } });
  };
  const deleteSelected = () => {
    if (docRef.current && selected) removeObject(selected.uid, selected.id);
  };
  const selectedObj = useMemo(() => (selected && doc ? doc.objects[selected.uid]?.find((o) => o.id === selected.id) ?? null : null), [selected, doc]);

  const updateSelected = (patch: Partial<TextObj> & Partial<{ stroke: Rgb | null; fill: Rgb | null; strokeWidth: number; opacity: number; color: Rgb }>, stylePatch?: Partial<ToolStyle>) => {
    if (stylePatch) setStyle((s) => ({ ...s, ...stylePatch }));
    if (selected && selectedObj) changeObject(selected.uid, { ...selectedObj, ...patch } as PageObject);
  };

  const addImage = async (files?: string[]) => {
    const picked = files ?? (await openDialog({ multiple: false, filters: IMAGE_FILTER }));
    if (!picked || !docRef.current) return;
    const list = Array.isArray(picked) ? picked : [picked];
    await run("Import de l'image…", async () => {
      for (const f of list) {
        const im = await normalizeImage(await api.readFile(f), f);
        const c = viewer.current?.centerOf(current - 1);
        if (!c) return;
        const k = Math.min(1, (c.w * 0.6) / im.width, (c.h * 0.6) / im.height);
        const [w, h] = [im.width * k, im.height * k];
        const a = (c.angle * Math.PI) / 180;
        const o: ImageObj = {
          id: newId(), kind: "image", angle: c.angle, w, h,
          x: c.x - (w / 2) * Math.cos(a) - (h / 2) * Math.sin(a),
          y: c.y - (w / 2) * Math.sin(a) + (h / 2) * Math.cos(a),
          bytes: im.bytes, mime: im.mime, url: imageUrl(im.bytes, im.mime),
        };
        addObject(docRef.current!.pages[current - 1].uid, o);
      }
      setTool("select");
    });
  };

  const editRun = async (pageIndex: number, _run: TextRun, edit: RunEdit) => {
    await run("Modification du texte…", async () => {
      const r = await core("editRun", await base(), pageIndex, _run.id, edit);
      commit(touchPages(docRef.current!, [pageIndex], r.bytes));
      if (!r.sameFont && edit.text) {
        const styled = Object.keys(edit).length > 1;
        say(styled ? `Texte écrit avec la police ${r.fontName}.` : `La police « ${_run.fontName} » du document ne contient pas tous ces caractères : ${r.fontName} est utilisée pour ce texte.`);
      }
    });
  };

  // --- Commandes des pages --------------------------------------------------------------------

  const insertFile = async () => {
    const r = await openDialog({ multiple: true, filters: PDF_FILTER });
    if (r) await insertFiles(Array.isArray(r) ? r : [r]);
  };
  const insertFiles = async (files: string[]) =>
    run("Insertion des pages…", async () => {
      let at = Math.max(...pageIndices()) + 1;
      for (const f of files) {
        const src = await readForEdit(f);
        const b = await base();
        const res = await core("insertFrom", b, at, src);
        commit(insertPagesAt(docRef.current!, at, res.count, res.bytes));
        at += res.count;
      }
    });

  /** Octets modifiables d'un fichier (mot de passe demandé au besoin). */
  const readForEdit = async (f: string) => {
    const data = await api.readFile(f);
    const info = await probe(data);
    if (!info.encrypted) return data;
    if (info.restricted) throw new Error(`${fileName(f)} : l'auteur a interdit la modification de ce document.`);
    return api.decrypt(data, info.password ?? "");
  };

  const duplicatePages = () => {
    const idx = new Set(pageIndices());
    const order: number[] = [];
    docRef.current!.pages.forEach((_, i) => {
      order.push(i);
      if (idx.has(i)) order.push(i);
    });
    void reorder(order, "Duplication…");
  };
  const deletePages = async () => {
    const d = docRef.current!;
    const idx = new Set(pageIndices());
    if (idx.size >= d.pages.length) {
      say("Un PDF doit garder au moins une page.", true);
      return;
    }
    await reorder(d.pages.map((_, i) => i).filter((i) => !idx.has(i)), "Suppression…");
    setSelection(new Set());
  };
  const rotate = (delta: number) =>
    run("Rotation…", async () => {
      const idx = pageIndices();
      commit(touchPages(docRef.current!, idx, await core("rotatePages", await base(), idx, delta)));
    });

  const scopeIndices = (scope: "all" | "selection") => (scope === "all" ? docRef.current!.pages.map((_, i) => i) : pageIndices());

  const rangesLabel = () => {
    const idx = [...pageIndices()].sort((a, b) => a - b);
    return idx.map((i) => i + 1).join(", ");
  };

  const baseName = () => (path ? fileName(path).replace(/\.pdf$/i, "") : "Document");

  // --- Actions du menu ---------------------------------------------------------------------------

  const actions: Record<string, () => unknown> = {
    new: () => setDialog({ kind: "new" }),
    fromImages: async () => {
      const r = await openDialog({ multiple: true, filters: IMAGE_FILTER });
      if (!r) return;
      const files = Array.isArray(r) ? r : [r];
      if (pristine) await run("Création…", () => createFromImages(files));
      else await api.newWindow(files);
    },
    open: pickOpen,
    save: () => {
      // Une zone de texte en cours de saisie est validée d'abord.
      if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
      return save();
    },
    saveAs,
    merge: () => setDialog({ kind: "merge" }),
    split: () => doc && setDialog({ kind: "split" }),
    password: () => canEdit && setDialog({ kind: "protect" }),
    metadata: () =>
      doc &&
      run("Lecture…", async () => {
        const initial = await core("getMetadata", doc.bytes).catch(() => ({ title: "", author: "", subject: "", keywords: "" }));
        setDialog({ kind: "metadata", initial });
      }),
    print: () => doc && setDialog({ kind: "print" }),
    close,
    undo: () => {
      const a = document.activeElement;
      if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) document.execCommand("undo");
      else undo();
    },
    redo: () => {
      const a = document.activeElement;
      if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) document.execCommand("redo");
      else redo();
    },
    copyObject: () => {
      clipboard.current = selectedObj;
    },
    pasteObject: () => {
      const c = clipboard.current;
      const d = docRef.current;
      if (!c || !d || readOnly) return;
      addObject(d.pages[current - 1].uid, { ...c, id: newId(), x: c.x + 12, y: c.y - 12 });
    },
    deleteObject: deleteSelected,
    find: () => {
      setFindOpen(true);
      window.setTimeout(() => (document.getElementById("find-input") as HTMLInputElement | null)?.select(), 0);
    },
    image: () => canEdit && addImage(),
    pageBlank: () => canEdit && setDialog({ kind: "blank" }),
    pageFile: () => canEdit && insertFile(),
    pageDuplicate: () => canEdit && duplicatePages(),
    pageDelete: () => canEdit && deletePages(),
    rotateLeft: () => canEdit && rotate(-90),
    rotateRight: () => canEdit && rotate(90),
    crop: () => canEdit && setDialog({ kind: "crop" }),
    extract: () => doc && !readOnly && setDialog({ kind: "extract" }),
    numbers: () => canEdit && setDialog({ kind: "numbers" }),
    watermark: () => canEdit && setDialog({ kind: "watermark" }),
    sidebar: () => setSidebar((s) => (s ? null : "pages")),
    zoomIn: () => viewer.current?.zoomBy(1.2),
    zoomOut: () => viewer.current?.zoomBy(1 / 1.2),
    zoomFit: () => viewer.current?.zoom("page-fit"),
    zoomWidth: () => viewer.current?.zoom("page-width"),
    zoomActual: () => viewer.current?.zoom(1),
    about: () => setDialog({ kind: "about" }),
  };
  for (const t of TOOLS) actions[`tool:${t.id}`] = () => canEdit && setTool(t.id);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Le menu et le clavier peuvent signaler le même appui (Windows) : une seule exécution.
  const lastCommand = useRef({ id: "", at: 0 });
  const runCommand = useCallback((id: string) => {
    const now = Date.now();
    if (lastCommand.current.id === id && now - lastCommand.current.at < 250) return;
    lastCommand.current = { id, at: now };
    void actionsRef.current[id]?.();
  }, []);

  useEffect(() => {
    void installMenu(runCommand);
    if (!IS_WINDOWS) return;
    const table = shortcuts();
    const onKey = (e: KeyboardEvent) => {
      const name = keyName(e);
      const id = table.get(name);
      const blocked = BROWSER_KEYS.has(name);
      if (!id && !blocked) return;
      const modal = !!document.querySelector(".modal");
      if (blocked || !modal) e.preventDefault();
      if (id && !modal && !e.repeat) runCommand(id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [runCommand]);

  // Clavier (hors des champs) ; fermeture de la fenêtre ; fichiers déposés.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape") {
        setTool("select");
        setSelected(null);
        if (findOpen) closeFind();
      } else if (selected && selectedObj && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key] ?? [0, 0];
        changeObject(selected.uid, { ...selectedObj, x: selectedObj.x + dx, y: selectedObj.y + dy });
      } else if ((e.ctrlKey || e.metaKey) && e.key === "c" && selectedObj) {
        clipboard.current = selectedObj;
      } else if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboard.current) {
        void actionsRef.current.pasteObject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const closeRef = useRef(close);
  closeRef.current = close;
  // Fichiers reçus pendant que la fenêtre est ouverte (Finder, second lancement).
  const launchRef = useRef<(files: string[]) => void>(() => {});
  launchRef.current = (files) => {
    const images = files.filter(isImage);
    if (images.length) void api.newWindow(images);
    void openFiles(files);
  };
  const dropRef = useRef<(files: string[], x: number, y: number) => void>(() => {});
  dropRef.current = (files, x, y) => {
    const pdfs = files.filter(isPdf);
    const images = files.filter(isImage);
    const el = document.elementFromPoint(x / window.devicePixelRatio, y / window.devicePixelRatio);
    if (images.length && canEdit) void addImage(images);
    if (!pdfs.length) return;
    if (el?.closest(".pw-side") && canEdit) void insertFiles(pdfs);
    else void openFiles(pdfs);
  };
  useEffect(() => {
    const w = getCurrentWindow();
    const un = [
      w.onCloseRequested(async (ev) => {
        if (closing.current) return;
        ev.preventDefault();
        await closeRef.current();
      }),
      w.onFocusChanged(({ payload }) => {
        if (payload) void activateMenu();
      }),
      w.listen("launch", async () => {
        const files = await api.takeLaunches();
        launchRef.current(files);
      }),
      getCurrentWebview().onDragDropEvent((ev) => {
        if (ev.payload.type === "drop") dropRef.current(ev.payload.paths, ev.payload.position.x, ev.payload.position.y);
      }),
    ];
    return () => un.forEach((u) => void u.then((f) => f()));
  }, []);

  // Titre de la fenêtre.
  useEffect(() => {
    const name = path ? fileName(path) : "Sans titre.pdf";
    void getCurrentWindow().setTitle(`${dirty ? "• " : ""}${name}${readOnly ? " (lecture seule)" : ""} — AuxiPDFWriter`);
  }, [path, dirty, readOnly]);

  // Taille de la page courante, signets.
  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    void pdf.getPage(Math.min(current, pdf.numPages)).then((p) => {
      if (!alive) return;
      const v = p.getViewport({ scale: 1 });
      const mm = (x: number) => Math.round((x * 25.4) / 72);
      setPageSize(`${mm(v.width)} × ${mm(v.height)} mm`);
    });
    return () => {
      alive = false;
    };
  }, [pdf, current]);

  const onReady = useCallback((p: PDFDocumentProxy, _lib: PdfLib) => {
    setPdf(p);
    void p.getOutline().then((o) => setOutline((o as OutlineItem[] | null) ?? []), () => setOutline([]));
    setCurrent((c) => Math.min(c, p.numPages));
  }, []);

  const closeFind = () => {
    setFindOpen(false);
    viewer.current?.closeFind();
  };

  // --- Résultats des dialogues -----------------------------------------------------------------

  const doMerge = (items: D.MergeItem[], bookmarks: boolean) =>
    run("Fusion…", async () => {
      setDialog(null);
      const sources = [];
      for (const it of items) {
        let bytes: Uint8Array;
        if (it.path) bytes = await readForEdit(it.path);
        else bytes = (await finalBytes()).flat;
        sources.push({ bytes, name: it.name, pages: it.pages.trim() ? parseRanges(it.pages, it.count!) : undefined });
      }
      const out = await core("merge", sources, { bookmarks });
      await deliver(out, "Fusion.pdf");
    });

  const doSplit = (m: D.SplitMode) =>
    run("Découpe…", async () => {
      setDialog(null);
      const d = docRef.current!;
      const groups = m.kind === "every" ? everyN(d.pages.length, m.n) : m.text.split("/").map((g) => parseRanges(g, d.pages.length));
      const dir = await openDialog({ directory: true, defaultPath: dirName(path ?? "") || undefined, title: "Dossier des fichiers découpés" });
      if (!dir || Array.isArray(dir)) return;
      const parts = await core("split", (await finalBytes()).flat, groups);
      const names = parts.map((_, i) => joinPath(dir, `${baseName()}_${String(i + 1).padStart(3, "0")}.pdf`));
      const infos = await Promise.all(names.map((n) => api.fileInfo(n)));
      const clash = infos.filter((i) => i.exists).length;
      if (clash) {
        const c = await ask("Fichiers existants", `${clash} fichier(s) portant ces noms existent déjà dans ce dossier. Les remplacer ?`, [
          { id: "no", label: "Annuler" },
          { id: "yes", label: "Remplacer", primary: true },
        ]);
        if (c !== "yes") return;
      }
      for (let i = 0; i < parts.length; i++) await api.writePdf(names[i], protect ? await api.encrypt(parts[i], protect) : parts[i]);
      say(`${parts.length} fichier(s) créés dans ${dir}.`);
    });

  const doExtract = (ranges: string) =>
    run("Extraction…", async () => {
      setDialog(null);
      const d = docRef.current!;
      const [out] = await core("split", (await finalBytes()).flat, [parseRanges(ranges, d.pages.length)]);
      await deliver(protect ? await api.encrypt(out, protect) : out, `${baseName()} (extrait).pdf`);
    });

  const doPrint = (o: { printer: string; copies: number; pages: string }) =>
    run("Impression…", async () => {
      setDialog(null);
      const temp = await api.writeTemp(path ? fileName(path) : "Document.pdf", (await finalBytes()).flat);
      const r = await api.printFile(temp, o);
      say(r || "Document envoyé à l'imprimante.");
    });

  const printSystem = () =>
    run("Préparation…", async () => {
      setDialog(null);
      await api.openSystem(await api.writeTemp(path ? fileName(path) : "Document.pdf", (await finalBytes()).flat));
    });

  // --- Affichage ---------------------------------------------------------------------------------

  const pageCount = doc?.pages.length ?? 0;
  const obj = selectedObj;
  const showProps = tool !== "select" && tool !== "editText" ? tool : obj?.kind ?? null;
  const zoomValue = ["auto", "page-fit", "page-width"].includes(scale.preset) ? scale.preset : "custom";

  return (
    <div className="app">
      <header className="toolbar">
        <div className="group">
          <button title="Ouvrir (Ctrl+O)" onClick={() => void pickOpen()}><Icon name="open" /></button>
          <button title="Enregistrer (Ctrl+S)" disabled={!canEdit || !dirty} onClick={() => void save()}><Icon name="save" /></button>
          <button title="Imprimer (Ctrl+P)" disabled={!doc} onClick={() => setDialog({ kind: "print" })}><Icon name="print" /></button>
        </div>
        <div className="group">
          <button title="Annuler (Ctrl+Z)" disabled={!history.current.undoList.length} onClick={undo}><Icon name="undo" /></button>
          <button title="Rétablir (Ctrl+Y)" disabled={!history.current.redoList.length} onClick={redo}><Icon name="redo" /></button>
        </div>
        <div className="group tools">
          {TOOLS.slice(0, 3).map((t) => (
            <button key={t.id} className={`${tool === t.id ? "on " : ""}${t.id === "editText" ? "wide" : ""}`} title={t.title} disabled={!canEdit && t.id !== "select"} onClick={() => setTool(t.id)}>
              <Icon name={t.icon} />{t.id === "editText" && <span>Modifier le texte</span>}{t.id === "text" && <span>Texte</span>}
            </button>
          ))}
          <button title="Image" disabled={!canEdit} onClick={() => void addImage()}><Icon name="image" /></button>
          {TOOLS.slice(3).map((t) => (
            <button key={t.id} className={tool === t.id ? "on" : ""} title={t.title} disabled={!canEdit} onClick={() => setTool(t.id)}><Icon name={t.icon} /></button>
          ))}
        </div>
        <div className="group">
          <button className="wide" title="Fusionner des PDF (Ctrl+Maj+M)" onClick={() => setDialog({ kind: "merge" })}><Icon name="merge" /><span>Fusionner</span></button>
          <button className="wide" title="Découper le document" disabled={!doc} onClick={() => setDialog({ kind: "split" })}><Icon name="split" /><span>Découper</span></button>
        </div>
        <div className="spacer" />
        <div className="group">
          <button title="Zoom arrière" onClick={() => viewer.current?.zoomBy(1 / 1.2)}><Icon name="zoomOut" /></button>
          <select className="zoom" aria-label="Zoom" value={zoomValue} onChange={(e) => viewer.current?.zoom(e.target.value === "custom" ? scale.scale : /^[\d.]+$/.test(e.target.value) ? Number(e.target.value) : e.target.value)}>
            <option value="auto">Automatique</option>
            <option value="page-fit">Page entière</option>
            <option value="page-width">Pleine largeur</option>
            <option value="custom">{Math.round(scale.scale * 100)} %</option>
            <option value="0.5">50 %</option><option value="0.75">75 %</option><option value="1">100 %</option><option value="1.5">150 %</option><option value="2">200 %</option><option value="3">300 %</option>
          </select>
          <button title="Zoom avant" onClick={() => viewer.current?.zoomBy(1.2)}><Icon name="zoomIn" /></button>
        </div>
        <div className="group">
          <button title="Rechercher (Ctrl+F)" onClick={() => void actions.find()}><Icon name="search" /></button>
        </div>
      </header>

      {showProps && canEdit ? (
        <PropsBar kind={showProps} obj={obj} style={style} update={updateSelected} onDelete={obj ? deleteSelected : undefined} />
      ) : (
        <div className="props">
          {!doc ? null : !canEdit ? <span className="muted">Lecture seule.</span> : tool === "editText" ? <span className="on-tip">Cliquez sur un texte du document pour le modifier. Entrée valide, Échap annule ; un texte vidé est supprimé.</span> : <span className="muted">Choisissez un outil, ou cliquez sur un objet ajouté pour le modifier.</span>}
        </div>
      )}
      {readOnly && <div className="banner">{readOnly}</div>}
      {protect && !readOnly && <div className="banner soft">Document protégé par mot de passe : il reste chiffré à l'enregistrement.</div>}

      {findOpen && (
        <div className="findbar">
          <input id="find-input" autoFocus placeholder="Rechercher dans le document" value={query} onChange={(e) => { setQuery(e.target.value); viewer.current?.find("", e.target.value, false, caseSensitive); }} onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") viewer.current?.find("again", query, e.shiftKey, caseSensitive);
            if (e.key === "Escape") closeFind();
          }} />
          <button title="Précédent" onClick={() => viewer.current?.find("again", query, true, caseSensitive)}><Icon name="up" size={15} /></button>
          <button title="Suivant" onClick={() => viewer.current?.find("again", query, false, caseSensitive)}><Icon name="down" size={15} /></button>
          <label className="check"><input type="checkbox" checked={caseSensitive} onChange={(e) => { setCaseSensitive(e.target.checked); viewer.current?.find("casesensitivitychange", query, false, e.target.checked); }} /> Respecter la casse</label>
          <span className={found.notFound ? "error-text" : "muted"}>{query ? (found.notFound ? "Introuvable" : found.total ? `${found.current} sur ${found.total}` : "") : ""}</span>
          <button title="Fermer" onClick={closeFind}><Icon name="close" size={15} /></button>
        </div>
      )}

      <div className="workspace">
        {sidebar && (
          <aside className="pw-side">
            <div className="side-tabs">
              <button className={sidebar === "pages" ? "on" : ""} title="Pages" onClick={() => setSidebar("pages")}><Icon name="thumbs" size={16} /> Pages</button>
              <button className={sidebar === "outline" ? "on" : ""} title="Signets" onClick={() => setSidebar("outline")}><Icon name="outline" size={16} /> Signets</button>
            </div>
            {sidebar === "pages" ? (
              <>
                <div className="page-tools">
                  <button title="Insérer une page vierge" disabled={!canEdit} onClick={() => setDialog({ kind: "blank" })}><Icon name="plus" size={16} /></button>
                  <button title="Insérer depuis un PDF" disabled={!canEdit} onClick={() => void insertFile()}><Icon name="fileIn" size={16} /></button>
                  <button title="Dupliquer" disabled={!canEdit} onClick={duplicatePages}><Icon name="copy" size={16} /></button>
                  <button title="Tourner à gauche" disabled={!canEdit} onClick={() => void rotate(-90)}><Icon name="rotL" size={16} /></button>
                  <button title="Tourner à droite" disabled={!canEdit} onClick={() => void rotate(90)}><Icon name="rotR" size={16} /></button>
                  <button title="Extraire" disabled={!canEdit} onClick={() => setDialog({ kind: "extract" })}><Icon name="extract" size={16} /></button>
                  <button title="Supprimer" disabled={!canEdit} onClick={() => void deletePages()}><Icon name="trash" size={16} /></button>
                </div>
                {doc && (
                  <Thumbs
                    pdf={pdf}
                    pages={doc.pages}
                    current={current}
                    selection={selection}
                    editable={canEdit}
                    onActivate={(i, m) => {
                      const uid = doc.pages[i].uid;
                      viewer.current?.goTo(i + 1);
                      setSelection((s) => {
                        if (m.ctrl) {
                          const n = new Set(s);
                          if (n.has(uid)) n.delete(uid);
                          else n.add(uid);
                          return n;
                        }
                        if (m.shift) {
                          const [a, b] = [Math.min(current - 1, i), Math.max(current - 1, i)];
                          return new Set(doc.pages.slice(a, b + 1).map((p) => p.uid));
                        }
                        return new Set();
                      });
                    }}
                    onMove={(moved, before) => {
                      void reorder(moveOrder(doc.pages.length, moved, before), "Déplacement…");
                    }}
                    onContext={(i, x, y) => {
                      if (!selection.has(doc.pages[i].uid)) {
                        setSelection(new Set([doc.pages[i].uid]));
                        viewer.current?.goTo(i + 1);
                      }
                      setCtx({ x, y });
                    }}
                  />
                )}
              </>
            ) : (
              <div className="outline">
                {outline.length === 0 ? <p className="muted empty-side">Ce document n'a pas de signets.</p> : <OutlineTree items={outline} go={(it) => {
                  if (it.dest) viewer.current?.goToDest(it.dest);
                  else if (it.url) void api.openSystem(it.url);
                }} />}
              </div>
            )}
          </aside>
        )}
        <main className="main">
          {fatal && <div className="fatal">{fatal}</div>}
          {doc && (
            <Viewer
              ref={viewer}
              bytes={doc.bytes}
              password={viewPassword}
              uids={doc.pages.map((p) => p.uid)}
              objects={doc.objects}
              tool={tool}
              selected={selected?.id ?? null}
              style={style}
              readOnly={!canEdit}
              onReady={onReady}
              onError={(m) => setFatal(`Affichage impossible : ${m}`)}
              onPage={(n) => { setCurrent(n); setPageInput(String(n)); }}
              onScale={(s, preset) => setScale({ scale: s, preset })}
              onFormDirty={() => setFormDirty(true)}
              onFind={setFound}
              onSelect={(id, uid) => setSelected(id && uid ? { id, uid } : null)}
              onChangeObject={(uid, o) => changeObject(uid, o)}
              onAddObject={(uid, o) => addObject(uid, o)}
              onRemoveObject={removeObject}
              onToolDone={() => setTool("select")}
              onEditRun={editRun}
              onLink={(h) => void api.openSystem(h)}
            />
          )}
        </main>
      </div>

      <footer className="statusbar">
        <button className="link" title="Panneau des pages (F4)" onClick={() => setSidebar((s) => (s ? null : "pages"))}><Icon name="thumbs" size={14} /></button>
        <span>Page</span>
        <input className="page-input" aria-label="Page" value={pageInput} onChange={(e) => setPageInput(e.target.value)} onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            const n = Number(pageInput);
            if (Number.isInteger(n)) viewer.current?.goTo(n);
            (e.target as HTMLInputElement).blur();
          }
        }} onBlur={() => setPageInput(String(current))} />
        <span>sur {pageCount}</span>
        <span className="muted">{pageSize}</span>
        {selection.size > 1 && <span className="muted">{selection.size} pages sélectionnées</span>}
        <span className="spacer" />
        {busy ? <span className="busy"><span className="spin" /> {busy}</span> : note && <span className={note.error ? "error-text" : ""}>{note.text}{note.error && <button className="link" title="Fermer" onClick={() => setNote(null)}><Icon name="close" size={12} /></button>}</span>}
      </footer>

      {ctx && (
        <div className="ctx-back" onPointerDown={() => setCtx(null)}>
          <div className="ctx" style={{ left: ctx.x, top: Math.min(ctx.y, window.innerHeight - 260) }} onPointerDown={(e) => e.stopPropagation()} onClick={() => setCtx(null)}>
            {([["pageBlank", "Insérer une page vierge"], ["pageFile", "Insérer depuis un PDF…"], ["pageDuplicate", "Dupliquer"], ["rotateLeft", "Tourner à gauche"], ["rotateRight", "Tourner à droite"], ["crop", "Recadrer…"], ["extract", "Extraire…"], ["pageDelete", "Supprimer"]] as const).map(([id, label]) => (
              <button key={id} disabled={!canEdit} onClick={() => void actions[id]()}>{label}</button>
            ))}
          </div>
        </div>
      )}

      {dialog?.kind === "new" && <D.NewDialog initial={specOf()} onCancel={() => setDialog(null)} onOk={(s) => {
        setDialog(null);
        prefsRef.current = { ...prefsRef.current, format: s.format, landscape: s.landscape };
        void api.prefsSave(prefsRef.current);
        if (pristine) void run("Création…", startBlank);
        else void api.newWindow([]);
      }} />}
      {dialog?.kind === "blank" && <D.BlankPagesDialog initial={specOf()} onCancel={() => setDialog(null)} onOk={(s, count) => {
        setDialog(null);
        void run("Insertion…", async () => {
          const at = Math.max(...pageIndices()) + 1;
          commit(insertPagesAt(docRef.current!, at, count, await core("insertBlank", await base(), at, s, count)));
        });
      }} />}
      {dialog?.kind === "merge" && <D.MergeDialog currentName={path ? fileName(path) : "Sans titre.pdf"} loadCount={async (p) => {
        if (!p) return docRef.current!.pages.length;
        const info = await probe(await api.readFile(p));
        return info.count;
      }} onCancel={() => setDialog(null)} onOk={doMerge} />}
      {dialog?.kind === "split" && <D.SplitDialog pageCount={pageCount} onCancel={() => setDialog(null)} onOk={doSplit} />}
      {dialog?.kind === "extract" && <D.ExtractDialog initial={rangesLabel()} pageCount={pageCount} onCancel={() => setDialog(null)} onOk={doExtract} />}
      {dialog?.kind === "numbers" && <D.NumberingDialog selected={pageIndices().length} onCancel={() => setDialog(null)} onOk={(o, scope) => {
        setDialog(null);
        void run("Numérotation…", async () => {
          const idx = scopeIndices(scope);
          commit(touchPages(docRef.current!, idx, await core("addPageNumbers", await base(), idx, o)));
        });
      }} />}
      {dialog?.kind === "watermark" && <D.WatermarkDialog selected={pageIndices().length} onCancel={() => setDialog(null)} onOk={(o, scope) => {
        setDialog(null);
        void run("Filigrane…", async () => {
          const idx = scopeIndices(scope);
          commit(touchPages(docRef.current!, idx, await core("addWatermark", await base(), idx, o)));
        });
      }} />}
      {dialog?.kind === "crop" && <D.CropDialog selected={pageIndices().length} onCancel={() => setDialog(null)} onOk={(m, scope) => {
        setDialog(null);
        void run("Recadrage…", async () => {
          const idx = scopeIndices(scope);
          commit(touchPages(docRef.current!, idx, await core("cropPages", await base(), idx, m)));
        });
      }} />}
      {dialog?.kind === "protect" && <D.ProtectDialog protectedNow={!!protect} onCancel={() => setDialog(null)} onOk={(p) => {
        setDialog(null);
        setProtect(p);
        savedRef.current = null;
        setDoc({ ...docRef.current! });
        say(p ? "Mot de passe défini : enregistrez pour l'appliquer." : "Protection retirée : enregistrez pour l'appliquer.");
      }} />}
      {dialog?.kind === "metadata" && <D.MetadataDialog initial={dialog.initial} facts={[["Pages", String(pageCount)], ["Taille de la page", pageSize], ["Fichier", path ?? "non enregistré"]]} onCancel={() => setDialog(null)} onOk={(m) => {
        setDialog(null);
        void run("Propriétés…", async () => {
          commit({ ...docRef.current!, bytes: await core("setMetadata", await base(), m) });
        });
      }} />}
      {dialog?.kind === "print" && <D.PrintDialog onCancel={() => setDialog(null)} onOk={doPrint} onSystem={printSystem} />}
      {dialog?.kind === "about" && <D.AboutDialog version={version} onClose={() => setDialog(null)} />}
      {passwordAsk && <D.PasswordPrompt retry={passwordAsk.retry} onSubmit={(p) => passwordAsk.resolve(p)} onCancel={() => passwordAsk.resolve(null)} />}
      {confirm && <D.Confirm title={confirm.title} text={confirm.text} buttons={confirm.buttons} onChoice={(id) => { confirm.resolve(id); setConfirm(null); }} />}
    </div>
  );
}

function OutlineTree({ items, go }: { items: OutlineItem[]; go: (i: OutlineItem) => void }) {
  return (
    <ul>
      {items.map((it, i) => (
        <li key={i}>
          <button className="outline-item" title={it.title} onClick={() => go(it)}>{it.title}</button>
          {it.items?.length > 0 && <OutlineTree items={it.items} go={go} />}
        </li>
      ))}
    </ul>
  );
}

const hex = (c: Rgb) => "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

function PropsBar({ kind, obj, style, update, onDelete }: {
  kind: string;
  obj: PageObject | null;
  style: ToolStyle;
  update: (patch: Record<string, unknown>, s?: Partial<ToolStyle>) => void;
  onDelete?: () => void;
}) {
  const t = obj?.kind === "text" ? obj : null;
  const shape = obj && (obj.kind === "rect" || obj.kind === "ellipse" || obj.kind === "line") ? obj : null;
  return (
    <div className="props">
      {kind === "text" && (
        <>
          <select aria-label="Police" value={t?.family ?? style.family} onChange={(e) => update({ family: e.target.value }, { family: e.target.value as FontFamily })}>
            <option value="Helvetica">Helvetica</option><option value="Times">Times</option><option value="Courier">Courier</option>
          </select>
          <input type="number" aria-label="Taille" min={4} max={400} value={t?.size ?? style.size} onChange={(e) => { const v = Math.max(4, Number(e.target.value) || 12); update({ size: v }, { size: v }); }} />
          <button className={(t?.bold ?? style.bold) ? "on" : ""} title="Gras" onClick={() => { const v = !(t?.bold ?? style.bold); update({ bold: v }, { bold: v }); }}><b>G</b></button>
          <button className={(t?.italic ?? style.italic) ? "on" : ""} title="Italique" onClick={() => { const v = !(t?.italic ?? style.italic); update({ italic: v }, { italic: v }); }}><i>I</i></button>
          <select aria-label="Alignement" value={t?.align ?? style.align} onChange={(e) => update({ align: e.target.value }, { align: e.target.value as Align })}>
            <option value="left">À gauche</option><option value="center">Centré</option><option value="right">À droite</option>
          </select>
          <label title="Couleur du texte">Couleur <input type="color" value={hex(t?.color ?? style.color)} onChange={(e) => { const c = D.rgbOf(e.target.value); update({ color: c }, { color: c }); }} /></label>
        </>
      )}
      {(kind === "rect" || kind === "ellipse" || kind === "line") && (
        <>
          <label title="Couleur du trait">Trait <input type="color" value={hex(shape?.stroke ?? style.color)} onChange={(e) => { const c = D.rgbOf(e.target.value); update({ stroke: c }, { color: c }); }} /></label>
          <label>Épaisseur <input type="number" min={0.25} max={40} step={0.25} value={shape?.strokeWidth ?? style.strokeWidth} onChange={(e) => { const v = Math.max(0.25, Number(e.target.value) || 1); update({ strokeWidth: v }, { strokeWidth: v }); }} /></label>
          {kind !== "line" && (
            <>
              <label className="check"><input type="checkbox" checked={!!(shape ? shape.fill : style.fill)} onChange={(e) => { const c: Rgb | null = e.target.checked ? [0.85, 0.9, 1] : null; update({ fill: c }, { fill: c }); }} /> Remplissage</label>
              {(shape ? shape.fill : style.fill) && <input type="color" aria-label="Couleur de remplissage" value={hex((shape ? shape.fill : style.fill)!)} onChange={(e) => { const c = D.rgbOf(e.target.value); update({ fill: c }, { fill: c }); }} />}
            </>
          )}
          <label>Opacité <input type="number" min={5} max={100} step={5} value={Math.round((shape?.opacity ?? style.opacity) * 100)} onChange={(e) => { const v = Math.min(1, Math.max(0.05, Number(e.target.value) / 100)); update({ opacity: v }, { opacity: v }); }} /> %</label>
        </>
      )}
      {kind === "highlight" && (
        <label>Couleur <input type="color" value={hex(obj?.kind === "highlight" ? obj.color : style.highlight)} onChange={(e) => { const c = D.rgbOf(e.target.value); update({ color: c }, { highlight: c }); }} /></label>
      )}
      {kind === "whiteout" && <span className="muted">Le masque cache l'affichage ; le contenu reste dans le fichier. Pour retirer un texte, utilisez « Modifier le texte » et videz-le.</span>}
      {kind === "image" && <span className="muted">Glissez un coin pour redimensionner.</span>}
      {onDelete && <button className="danger" title="Supprimer (Suppr)" onClick={onDelete}><Icon name="trash" size={16} /></button>}
    </div>
  );
}
