// AuxiSheet Lite : tableur d'AuxiOffice Online qui fonctionne entièrement
// dans le navigateur. Le calcul et l'interface sont ceux d'IronCalc (Rust
// compilé en WebAssembly) ; la lecture et l'écriture des .xlsx aussi
// (online/sheet-wasm). Le serveur ne fait que garder le fichier : aucun
// moteur n'y est démarré.

import { IronCalc, init as initIronCalc, Model, type IronCalcHandle } from "@ironcalc/workbook";
import "@ironcalc/workbook/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { launch } from "../shared/apps";
import { messageBox, pickFile, toast } from "../shared/dialogs";
import { baseName, files } from "../shared/http";
import "../shared/online.css";
import "./sheet.css";

/** Format des nombres et des dates, et langue des noms de fonctions (SOMME…). */
const LOCALE = "fr";
const LANG = "fr";
const TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";
  } catch {
    return "America/Toronto";
  }
})();

interface Lite {
  xlsx_to_model(bytes: Uint8Array, name: string, locale: string, tz: string, lang: string): Uint8Array;
  model_to_xlsx(bytes: Uint8Array, lang: string): Uint8Array;
}

async function loadLite(): Promise<Lite> {
  const m = await import("../wasm/auxisheet_lite_wasm.js");
  const url = (await import("../wasm/auxisheet_lite_wasm_bg.wasm?url")).default;
  await m.default({ module_or_path: url });
  return m as unknown as Lite;
}

const params = new URLSearchParams(location.search);
const IS_MAC = navigator.platform.toLowerCase().includes("mac");

type State = { status: "loading"; text: string } | { status: "error"; text: string } | { status: "ready" };

function App() {
  const [state, setState] = useState<State>({ status: "loading", text: "Chargement du tableur…" });
  const [model, setModel] = useState<Model | null>(null);
  const [path, setPath] = useState<string | null>(params.get("open"));
  const [modified, setModified] = useState(false);
  const [busy, setBusy] = useState(false);
  const lite = useRef<Lite | null>(null);
  const ref = useRef<IronCalcHandle>(null);
  /** Fichier venu d'ailleurs : prévenir avant de l'écraser (graphiques, images…). */
  const warned = useRef(!params.get("open"));

  useEffect(() => {
    (async () => {
      try {
        const [, l] = await Promise.all([initIronCalc(), loadLite()]);
        lite.current = l;
        let m: Model;
        const p = params.get("open");
        if (p) {
          setState({ status: "loading", text: `Ouverture de « ${baseName(p)} »…` });
          const bytes = new Uint8Array(await files.read(p));
          m = Model.fromBytes(l.xlsx_to_model(bytes, baseName(p).replace(/\.xlsx$/i, ""), LOCALE, TZ, LANG), LANG);
        } else {
          m = new Model("Classeur", LOCALE, TZ, LANG);
        }
        m.flushSendQueue();
        setModel(m);
        setState({ status: "ready" });
        history.replaceState(null, "", location.pathname);
      } catch (e) {
        setState({ status: "error", text: String(e instanceof Error ? e.message : e) });
      }
    })();
  }, []);

  useEffect(() => {
    ref.current?.setLanguage("fr-FR");
  }, [model]);

  // Modifications : la file des changements du modèle n'est pas vide et il
  // y a quelque chose à annuler (au chargement, le tableur émet des
  // changements internes qui ne sont pas des modifications).
  useEffect(() => {
    if (!model) return;
    const t = window.setInterval(() => {
      if (model.flushSendQueue().length && model.canUndo()) setModified(true);
    }, 400);
    return () => clearInterval(t);
  }, [model]);

  const name = path ? baseName(path) : "Sans titre.xlsx";
  useEffect(() => {
    document.title = `${modified ? "• " : ""}${name} — AuxiSheet Lite`;
  }, [name, modified]);

  const write = useCallback(
    async (target: string): Promise<string | null> => {
      if (!model || !lite.current) return null;
      setBusy(true);
      try {
        const bytes = lite.current.model_to_xlsx(model.toBytes(), LANG);
        await files.write(target, new Blob([bytes as Uint8Array<ArrayBuffer>]));
        model.flushSendQueue();
        setPath(target);
        setModified(false);
        toast("Classeur enregistré.", 2000);
        return target;
      } catch (e) {
        await messageBox(`L'enregistrement a échoué.\n\n${e instanceof Error ? e.message : e}`, { title: "AuxiSheet Lite", kind: "error" });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [model],
  );

  const saveAs = useCallback(async (): Promise<string | null> => {
    const chosen = (await pickFile({ mode: "save", filters: [{ name: "Classeur Excel", extensions: ["xlsx"] }], defaultPath: path && !path.startsWith("/.temp/") ? path.replace(/\.[^.]+$/, ".xlsx") : "Sans titre.xlsx" })) as string | null;
    if (!chosen) return null;
    warned.current = true;
    return write(/\.xlsx$/i.test(chosen) ? chosen : `${chosen}.xlsx`);
  }, [path, write]);

  const save = useCallback(async (): Promise<string | null> => {
    if (!path || !/\.xlsx$/i.test(path)) return saveAs();
    if (!warned.current) {
      const choice = await messageBox(
        "AuxiSheet Lite enregistre les données, les formules et la mise en forme des cellules.\n\nSi ce classeur contient des graphiques, des images, des tableaux croisés dynamiques ou des macros, ils ne seront pas conservés. Dans ce cas, enregistrez plutôt une copie, ou ouvrez le classeur dans AuxiSheet.",
        { title: "Enregistrer", kind: "warning", buttons: ["Enregistrer", "Enregistrer une copie…", "Annuler"] },
      );
      if (choice === "Enregistrer une copie…") return saveAs();
      if (choice !== "Enregistrer") return null;
      warned.current = true;
    }
    return write(path);
  }, [path, saveAs, write]);

  const download = useCallback(() => {
    if (!model || !lite.current) return;
    const bytes = lite.current.model_to_xlsx(model.toBytes(), LANG);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = name.replace(/\.[^.]+$/, "") + ".xlsx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }, [model, name]);

  const openFull = useCallback(async () => {
    let target = path;
    if (modified || !target) {
      const choice = await messageBox("Le classeur doit d'abord être enregistré pour être ouvert dans AuxiSheet.", { title: "Ouvrir dans AuxiSheet", buttons: ["Enregistrer", "Annuler"] });
      if (choice !== "Enregistrer") return;
      target = await (target ? save() : saveAs());
      if (!target) return;
    }
    launch("sheet", [target]);
  }, [modified, path, save, saveAs]);


  // Raccourcis : Ctrl+S, Ctrl+Maj+S (avant le tableur).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      if (mod && !e.altKey && e.code === "KeyS") {
        e.preventDefault();
        e.stopPropagation();
        void (e.shiftKey ? saveAs() : save());
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [save, saveAs]);

  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (modified) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [modified]);

  return (
    <div className="lite">
      <header className="lite-bar">
        <img src="/icons/auxisheet.svg" alt="" />
        <span className="lite-app">
          AuxiSheet <b>Lite</b>
        </span>
        <span className="lite-name" title={path ?? ""}>
          {modified ? "• " : ""}
          {name}
        </span>
        <span className="lite-chip" title="Ce tableur fonctionne entièrement dans votre navigateur : rien n'est calculé sur le serveur.">
          dans votre navigateur
        </span>
        <span className="spacer" />
        <button onClick={() => window.open("/sheet/?new=1", "_blank")} title="Nouveau classeur (nouvel onglet)">
          Nouveau
        </button>
        <button onClick={() => void save()} disabled={!model || busy} title={`Enregistrer (${IS_MAC ? "⌘" : "Ctrl"}+S)`}>
          Enregistrer
        </button>
        <button onClick={() => void saveAs()} disabled={!model || busy}>
          Enregistrer sous…
        </button>
        <button onClick={download} disabled={!model} title="Télécharger une copie .xlsx sur cet ordinateur">
          Télécharger
        </button>
        <button onClick={() => void openFull()} disabled={!model || busy} title="Graphiques, tableaux croisés, mise en page et impression : AuxiSheet complet">
          Ouvrir dans AuxiSheet
        </button>
        <a className="lite-home" href="/" target="_blank">
          Mes fichiers
        </a>
      </header>
      <main className="lite-main">
        {state.status !== "ready" && <div className={`lite-state ${state.status}`}>{state.text}</div>}
        {model && state.status === "ready" && <IronCalc ref={ref} model={model} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
