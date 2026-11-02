// Tout ce que le fil de travail sait faire (voir worker.ts, client.ts).

import { flatten } from "./objects";
import * as P from "./pages";
import { editRun, listRuns } from "./textedit";

export const coreApi = {
  createBlank: P.createBlank,
  imagesToPdf: P.imagesToPdf,
  rearrange: P.rearrange,
  insertBlank: P.insertBlank,
  rotatePages: P.rotatePages,
  cropPages: P.cropPages,
  merge: P.merge,
  insertFrom: P.insertFrom,
  split: P.split,
  addPageNumbers: P.addPageNumbers,
  addWatermark: P.addWatermark,
  getMetadata: P.getMetadata,
  setMetadata: P.setMetadata,
  flatten,
  listRuns,
  editRun,
};

export type CoreApi = typeof coreApi;
