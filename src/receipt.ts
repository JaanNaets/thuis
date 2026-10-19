import { isComplete, parseReceiptText, type ReceiptReadResult } from "../shared/receipt";
import { api } from "./api";
import { prepareForReading } from "./image";

/**
 * Leest een kasticket of factuur, zo goedkoop mogelijk:
 * 1. PDF met tekst (webshopfacturen): tekst eruit halen en met code lezen. Gratis en exact.
 * 2. Lukt dat niet volledig, of is het een foto: een verkleinde afbeelding meesturen,
 *    dan leest de Worker die met AI (binnen de gratis hoeveelheid van Workers AI).
 */
export async function readReceipt(file: File): Promise<ReceiptReadResult> {
  const body = new FormData();

  if (file.type === "application/pdf") {
    const { pdfText, pdfFirstPageImage } = await import("./pdf");
    const text = await pdfText(file);
    body.append("text", text);
    // Enkel een afbeelding meesturen als de code niet alles vond (bv. een gescande PDF).
    if (!isComplete(parseReceiptText(text))) {
      const page = await pdfFirstPageImage(file);
      if (page) body.append("image", page, "pagina-1.jpg");
    }
  } else if (file.type.startsWith("image/")) {
    body.append("image", await prepareForReading(file));
  } else {
    throw new Error("Dit bestandstype kan niet gelezen worden.");
  }

  return api.post<ReceiptReadResult>("/receipts/read", body);
}
