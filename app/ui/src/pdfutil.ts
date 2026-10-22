// AuxiPDF : petites fonctions de présentation (dates, tailles, liens),
// sans dépendance à PDF.js (testées par vitest).

/** Date PDF (« D:20260115093000-05'00' ») en texte lisible. */
export function pdfDate(s: unknown): string {
  if (typeof s !== "string") return "";
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s);
  if (!m) return s;
  const [, y, mo = "01", d = "01", h = "00", mi = "00"] = m;
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

/** Taille de page en points → texte (mm et pouces, nom du format usuel). */
export function pageSizeLabel(wPt: number, hPt: number): string {
  const mm = (pt: number) => Math.round((pt * 25.4) / 72);
  const inch = (pt: number) => Math.round((pt / 72) * 100) / 100;
  const [a, b] = [Math.min(wPt, hPt), Math.max(wPt, hPt)];
  const near = (x: number, y: number) => Math.abs(x - y) < 3;
  const names: [number, number, string][] = [
    [612, 792, "Lettre US"],
    [612, 1008, "Légal US"],
    [595.28, 841.89, "A4"],
    [419.53, 595.28, "A5"],
    [841.89, 1190.55, "A3"],
    [792, 1224, "Tabloïd"],
  ];
  const name = names.find(([x, y]) => near(a, x) && near(b, y))?.[2];
  const orient = wPt > hPt ? ", paysage" : "";
  return `${mm(wPt)} × ${mm(hPt)} mm (${String(inch(wPt)).replace(".", ",")} × ${String(inch(hPt)).replace(".", ",")} po)${name ? ` — ${name}${orient}` : ""}`;
}

/** Taille d'un fichier lisible (« 1,4 Mo »). */
export function sizeLabel(n: number): string {
  if (n < 1024) return `${n} octets`;
  const units = ["Ko", "Mo", "Go"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${(Math.round(v * 10) / 10).toString().replace(".", ",")} ${units[i]}`;
}

/** Lien externe d'un PDF que l'on accepte d'ouvrir dans le navigateur. */
export function isExternalLink(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim());
}
