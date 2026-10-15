// Icônes de l'interface (SVG en ligne, trait 1.6, grille 20×20) : aucune
// dépendance aux polices d'emoji du système.

const P: Record<string, string> = {
  save: "M4 3h10l3 3v11H3V3zm3 0v4h6V3M6 17v-5h8v5",
  pdf: "M5 2h7l4 4v12H5zM12 2v4h4M7.5 11h5M7.5 14h5",
  undo: "M7 5L3 9l4 4M3 9h9a5 5 0 010 10h-2",
  redo: "M13 5l4 4-4 4M17 9H8a5 5 0 000 10h2",
  alignLeft: "M3 4h14M3 8h9M3 12h14M3 16h9",
  alignCenter: "M3 4h14M5.5 8h9M3 12h14M5.5 16h9",
  alignRight: "M3 4h14M8 8h9M3 12h14M8 16h9",
  justify: "M3 4h14M3 8h14M3 12h14M3 16h14",
  bullets: "M8 5h9M8 10h9M8 15h9M4 5h.01M4 10h.01M4 15h.01",
  numbering: "M8 5h9M8 10h9M8 15h9M3.5 3.5l1-.5v4M3 12.5c.5-1 2-1 2 0s-2 1.5-2 2.5h2",
  table: "M3 4h14v12H3zM3 8h14M3 12h14M8 4v12M13 4v12",
  image: "M3 4h14v12H3zM3 13l4-4 4 4 2-2 4 4M13 7.5h.01",
  pagebreak: "M5 2v5h10V2M5 18v-5h10v5M2 10h2M7 10h2M11 10h2M16 10h2",
  track: "M4 16l1-4 8-8 3 3-8 8zM11 6l3 3M3 18h14",
  sum: "M15 4H5l5 6-5 6h10",
  currency: "M10 2v16M14 5.5C13 4.5 11.5 4 10 4 8 4 6 5 6 7s2 2.7 4 3 4 1 4 3-2 3-4 3c-1.6 0-3.2-.6-4-1.8",
  percent: "M15 4L5 16M6 5.5h.01M14 14.5h.01",
  wrap: "M3 5h14M3 10h11a3 3 0 010 6h-3m0 0l2-2m-2 2l2 2M3 15h5",
  merge: "M3 4h14v12H3zM7 10H3m14 0h-4M9 8l2 2-2 2M11 8l-2 2 2 2",
  sort: "M6 3v14M3 14l3 3 3-3M12 4h5M12 8h4M12 12h3M12 16h2",
  filter: "M3 4h14l-5.5 6.5V16l-3 1.5v-7z",
  rowAdd: "M3 8h14v8H3zM10 1v5M7.5 3.5h5",
  colAdd: "M8 3h8v14H8zM1 10h5M3.5 7.5v5",
  freeze: "M3 3h14v14H3zM3 8h14M8 3v14",
  slideAdd: "M2 4h12v9H2zM16 12v6M13 15h6",
  slideDup: "M5 6h12v9H5zM2 3h12v9",
  slideDel: "M2 4h12v9H2zM13 15l5 5M18 15l-5 5",
  fit: "M2 10h16M5 7l-3 3 3 3M15 7l3 3-3 3",
  zoomIn: "M9 4a5 5 0 110 10A5 5 0 019 4zM13 13l4 4M7 9h4M9 7v4",
  zoomOut: "M9 4a5 5 0 110 10A5 5 0 019 4zM13 13l4 4M7 9h4",
  open: "M2 5h6l2 2h8v9H2zM2 9h16",
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}
