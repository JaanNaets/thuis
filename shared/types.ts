// Types die zowel de Worker (API) als de React-app gebruiken.

export type Purchase = {
  id: string;
  description: string;
  store: string | null;
  purchased_on: string;
  amount_cents: number | null;
  category: string | null;
  warranty_until: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
};

export type PurchaseListItem = Purchase & {
  file_count: number;
  thumbnail_file_id: string | null;
};

export type PurchaseFile = {
  id: string;
  purchase_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

export type PurchaseWithFiles = Purchase & { files: PurchaseFile[] };

export type PurchaseInput = Pick<
  Purchase,
  "description" | "store" | "purchased_on" | "amount_cents" | "category" | "warranty_until" | "notes"
>;

export type LoyaltyCard = {
  id: string;
  name: string;
  card_number: string;
  format: BarcodeFormat;
  color: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
};

export type LoyaltyCardInput = Pick<LoyaltyCard, "name" | "card_number" | "format" | "color" | "notes">;

// Namen volgens de Barcode Detection API (wat de scanner teruggeeft),
// met het bijhorende symbool in bwip-js (waarmee we de barcode tekenen).
export const BARCODE_FORMATS = {
  ean_13: { label: "EAN-13", bwip: "ean13" },
  ean_8: { label: "EAN-8", bwip: "ean8" },
  upc_a: { label: "UPC-A", bwip: "upca" },
  upc_e: { label: "UPC-E", bwip: "upce" },
  code_128: { label: "Code 128", bwip: "code128" },
  code_39: { label: "Code 39", bwip: "code39" },
  code_93: { label: "Code 93", bwip: "code93" },
  itf: { label: "ITF", bwip: "interleaved2of5" },
  codabar: { label: "Codabar", bwip: "rationalizedCodabar" },
  qr_code: { label: "QR-code", bwip: "qrcode" },
  data_matrix: { label: "Data Matrix", bwip: "datamatrix" },
  pdf417: { label: "PDF417", bwip: "pdf417" },
  aztec: { label: "Aztec", bwip: "azteccode" },
} as const;

export type BarcodeFormat = keyof typeof BARCODE_FORMATS;

export function isBarcodeFormat(value: unknown): value is BarcodeFormat {
  return typeof value === "string" && Object.hasOwn(BARCODE_FORMATS, value);
}
