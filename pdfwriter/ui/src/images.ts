// Images importées : PNG et JPEG gardés tels quels, les autres formats convertis en PNG.

export interface LoadedImage {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

export async function normalizeImage(data: Uint8Array, nameHint: string): Promise<LoadedImage> {
  const lower = nameHint.toLowerCase();
  const sourceType = lower.endsWith(".png") ? "image/png" : /\.jpe?g$/.test(lower) ? "image/jpeg" : lower.endsWith(".webp") ? "image/webp" : lower.endsWith(".gif") ? "image/gif" : "image/bmp";
  const blob = new Blob([data as BlobPart], { type: sourceType });
  const bmp = await createImageBitmap(blob);
  const { width, height } = bmp;
  if (sourceType === "image/png" || sourceType === "image/jpeg") {
    bmp.close();
    return { bytes: data, mime: sourceType, width, height };
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  const png = await new Promise<Blob>((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("Conversion de l'image impossible"))), "image/png"));
  return { bytes: new Uint8Array(await png.arrayBuffer()), mime: "image/png", width, height };
}

export const imageUrl = (bytes: Uint8Array, mime: string) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
