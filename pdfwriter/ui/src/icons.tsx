// Pictogrammes de l'interface.
const paths: Record<string, string> = {
  open: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  save: "M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1zM8 3v5h7V3M7 21v-7h10v7",
  print: "M7 8V3h10v5M7 17H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-3M7 14h10v7H7z",
  undo: "M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3",
  redo: "m15 7 5 5-5 5M20 12H9a5 5 0 0 0 0 10h3",
  pointer: "M5 3l14 9-6 1.5L10 20z",
  editText: "M4 7V5h12v2M10 5v14M7 19h6M14 19l1-3 5-5 2 2-5 5z",
  text: "M5 7V4h14v3M12 4v16M9 20h6",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9a1 1 0 1 0 0-.01",
  rect: "M4 6h16v12H4z",
  ellipse: "M12 5c5 0 9 3.1 9 7s-4 7-9 7-9-3.1-9-7 4-7 9-7z",
  line: "M5 19 19 5",
  highlight: "M4 20h16M7 16l-1-1 8-8 4 4-8 8H7zM13 8l3-3 3 3-3 3",
  whiteout: "M4 6h16v12H4zM4 12h16",
  merge: "M6 3v5a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v5M18 3v5a4 4 0 0 1-4 4M3 18l3 3 3-3",
  split: "M12 3v7M12 10l-6 6v5M12 10l6 6v5M3 18l3 3 3-3M15 18l3 3 3-3",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M8 11h6M11 8v6",
  zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M8 11h6",
  plus: "M12 5v14M5 12h14",
  fileIn: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 11v6M9 14h6",
  copy: "M9 9h11v12H9zM5 15H4V3h11v1",
  rotL: "M4 4v5h5M4 9a8 8 0 1 1-1 5",
  rotR: "M20 4v5h-5M20 9a8 8 0 1 0 1 5",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  extract: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 17v-6M9 14l3 3 3-3",
  close: "M6 6l12 12M18 6 6 18",
  up: "m6 15 6-6 6 6",
  down: "m6 9 6 6 6-6",
  thumbs: "M4 4h6v7H4zM14 4h6v7h-6zM4 14h6v7H4zM14 14h6v7h-6z",
  outline: "M4 6h2M9 6h11M6 12h2M11 12h9M6 18h2M11 18h9",
  check: "M5 13l4 4 10-11",
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
