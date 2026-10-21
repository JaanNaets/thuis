/**
 * Verkleint een foto in de browser. Een gsm-foto is al snel 4-8 MB:
 * - om te bewaren volstaat 2000 px ruim (prepareUpload);
 * - om automatisch te lezen is 1280 px genoeg, en kleiner = goedkoper (prepareForReading).
 * Andere bestanden (PDF) blijven ongemoeid.
 */
export function prepareUpload(file: File): Promise<File> {
  return resize(file, 2000, 0.85);
}

export function prepareForReading(file: File): Promise<File> {
  return resize(file, 1280, 0.8);
}

/** Logo van een verkoper: hoogstens 256 px, als PNG zodat een doorzichtige achtergrond blijft. */
export function prepareLogo(file: File): Promise<File> {
  return resize(file, 256, 1, "image/png");
}

async function resize(file: File, maxSide: number, quality: number, type: "image/jpeg" | "image/png" = "image/jpeg"): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Formaat dat deze browser niet kan lezen (bv. HEIC in Chrome): origineel gebruiken.
    return file;
  }

  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.type === type && file.size < 1_500_000) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) return file;

  const name = file.name.replace(/\.[^.]+$/, "") + (type === "image/png" ? ".png" : ".jpg");
  return new File([blob], name, { type });
}
