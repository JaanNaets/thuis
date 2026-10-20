export type ScanResult = { rawValue: string; format: string };

type Detector = { detect(source: ImageBitmapSource): Promise<ScanResult[]> };

/**
 * Chrome op Android heeft een ingebouwde BarcodeDetector. Safari (iPhone) en desktop niet;
 * daar laden we een WebAssembly-versie van ZXing (±1 MB, enkel wanneer je effectief scant).
 */
async function createDetector(): Promise<Detector> {
  if ("BarcodeDetector" in window) {
    const Native = (window as unknown as { BarcodeDetector: new () => Detector }).BarcodeDetector;
    return new Native();
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import("barcode-detector/ponyfill"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
    },
  });
  return new BarcodeDetector();
}

let detector: Promise<Detector> | undefined;

/** Eén detector voor de hele app; laden mag mislukken (offline) en later opnieuw proberen. */
export function getDetector(): Promise<Detector> {
  detector ??= createDetector().catch((err) => {
    detector = undefined;
    throw err;
  });
  return detector;
}

function toCanvas(bitmap: ImageBitmap, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Zoekt een barcode op een foto of screenshot (bv. uit de app van de winkel).
 * Eerst verkleind (snel), en enkel als dat niets geeft op ware grootte (kleine codes op een grote foto).
 */
export async function detectInImage(file: Blob): Promise<ScanResult | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Deze foto kan niet geopend worden. Probeer een JPG of PNG.");
  }

  try {
    const found = await getDetector();
    const sizes = Math.max(bitmap.width, bitmap.height) > 2000 ? [2000, 4000] : [2000];
    for (const size of sizes) {
      const [hit] = await found.detect(toCanvas(bitmap, size));
      if (hit) return { rawValue: hit.rawValue, format: hit.format };
    }
    return null;
  } finally {
    bitmap.close();
  }
}
