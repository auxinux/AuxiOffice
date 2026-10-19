import { createRoot } from "react-dom/client";
import { App } from "./App";
import { uiLog } from "./engine";
import "./styles.css";

// Erreur imprévue de l'interface : l'afficher plutôt qu'une fenêtre vide.
function showFatal(text: string) {
  const pre = document.createElement("pre");
  pre.className = "fatal";
  pre.textContent = `Erreur de l'interface d'AuxiOffice :\n${text}`;
  document.body.appendChild(pre);
  uiLog(text);
}
window.addEventListener("error", (e) => showFatal(`${e.message}\n${e.error?.stack ?? ""}`));
window.addEventListener("unhandledrejection", (e) => showFatal(`${e.reason}\n${e.reason?.stack ?? ""}`));

// Pas de StrictMode : ses doubles exécutions d'effets lanceraient deux
// moteurs par document en développement.
createRoot(document.getElementById("root")!).render(<App />);
