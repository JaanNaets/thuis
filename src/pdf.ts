// pdf.js op één plek instellen. Dit bestand wordt enkel (lui) geladen wanneer er een PDF in het spel is.
// De "legacy"-build bevat polyfills, zodat PDF's ook op oudere tablets (bv. een iPad in kioskmodus) werken.
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export { getDocument };

type TextItem = { str: string; transform: number[] };

/** Tekst van de eerste pagina's, regel per regel (stukjes op dezelfde hoogte vormen één regel). */
export async function pdfText(file: File, maxPages = 3): Promise<string> {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  const lines: string[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const rows = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as TextItem[]) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      rows.set(y, [...(rows.get(y) ?? []), { x: item.transform[4], str: item.str }]);
    }
    [...rows.entries()]
      .sort(([a], [b]) => b - a)
      .forEach(([, row]) => lines.push(row.sort((a, b) => a.x - b.x).map((r) => r.str).join(" ")));
  }
  await task.destroy();
  return lines.join("\n");
}

/** Eerste pagina als JPEG, voor gescande PDF's zonder tekst. */
export async function pdfFirstPageImage(file: File, maxSide = 1280): Promise<Blob | null> {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: maxSide / Math.max(base.width, base.height) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
  await task.destroy();
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
}
