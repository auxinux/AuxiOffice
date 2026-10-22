import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// Pas de menu contextuel du navigateur (Recharger, Inspecter…) hors des champs.
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement | null;
  if (!t?.closest(".cm-editor, input, textarea")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(<App />);
