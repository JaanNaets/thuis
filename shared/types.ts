// Types die zowel de Worker (API) als de React-app gebruiken.

// ---------- algemeen ----------

/** De pastelkleuren van de app. Categorieën, tags en leden krijgen er een van. */
export const TONES = ["peach", "butter", "sage", "mint", "sky", "lilac", "rose"] as const;
export type Tone = (typeof TONES)[number];

export function isTone(value: unknown): value is Tone {
  return typeof value === "string" && (TONES as readonly string[]).includes(value);
}

export type Me = { email: string; member: Member };

/** Tellers voor de navigatie. */
export type Stats = { purchases: number; items: number; low: number; expiring: number; cards: number };

// ---------- huishouden en indeling ----------

export type Member = {
  id: string;
  name: string;
  email: string | null;
  color: Tone | null;
  active: 0 | 1;
  created_at: string;
};

export type MemberInput = Pick<Member, "name" | "email" | "color" | "active">;

export const CATEGORY_DOMAINS = ["expense", "item"] as const;
export type CategoryDomain = (typeof CATEGORY_DOMAINS)[number];

export type Category = {
  id: string;
  domain: CategoryDomain;
  parent_id: string | null;
  name: string;
  color: Tone | null;
  sort_order: number;
};

export type Location = {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
};

/** Winkel, webshop, vakman, iemand op 2dehands: waar iets vandaan komt. */
export type Vendor = {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  notes: string | null;
  /** Aantal aankopen bij deze verkoper. */
  usage: number;
};

export type VendorInput = Pick<Vendor, "name" | "website" | "phone" | "notes">;

export type Tag = {
  id: string;
  name: string;
  color: Tone | null;
  /** Aan hoeveel dingen de tag hangt. */
  usage: number;
};

/** Alles wat formulieren nodig hebben om iets in te delen, in één aanvraag. */
export type Taxonomy = {
  /** Wie nu aangemeld is. */
  me: Member;
  members: Member[];
  categories: Category[];
  locations: Location[];
  tags: Tag[];
  vendors: Vendor[];
};

// ---------- aankopen en uitgaven ----------

export const SPLIT_MODES = ["equal", "personal", "custom"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

export type ExpenseShare = { member_id: string; share_cents: number };

export type Purchase = {
  id: string;
  description: string;
  vendor_id: string | null;
  purchased_on: string;
  amount_cents: number | null;
  category_id: string | null;
  /** NULL = betaald van de gezamenlijke rekening; telt niet mee in wie-betaalde-wat. */
  paid_by: string | null;
  split_mode: SplitMode | null;
  warranty_until: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
};

export type PurchaseListItem = Purchase & {
  vendor_name: string | null;
  category_name: string | null;
  category_color: Tone | null;
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

export type PurchaseDetail = Purchase & {
  vendor_name: string | null;
  category_name: string | null;
  category_color: Tone | null;
  files: PurchaseFile[];
  shares: ExpenseShare[];
  tag_ids: string[];
  /** Voorraad die met deze aankoop binnenkwam. */
  items: { id: string; name: string }[];
};

export type PurchaseInput = Pick<
  Purchase,
  | "description"
  | "purchased_on"
  | "amount_cents"
  | "category_id"
  | "paid_by"
  | "split_mode"
  | "warranty_until"
  | "notes"
> & {
  /** Naam van de verkoper; een nieuwe naam wordt meteen een nieuwe verkoper. */
  vendor: string | null;
  /** Enkel bij split_mode "custom"; anders rekent de server de delen zelf uit. */
  shares?: ExpenseShare[];
  tag_ids: string[];
};

export type Settlement = {
  id: string;
  from_member_id: string;
  to_member_id: string;
  amount_cents: number;
  settled_on: string;
  note: string | null;
  created_by: string;
  created_at: string;
};

export type SettlementInput = Pick<Settlement, "from_member_id" | "to_member_id" | "amount_cents" | "settled_on" | "note">;

export type Transfer = { from: string; to: string; amount_cents: number };

export type ExpenseEntry =
  | {
      kind: "purchase";
      id: string;
      date: string;
      description: string;
      amount_cents: number | null;
      paid_by: string | null;
      split_mode: SplitMode | null;
      category_name: string | null;
      category_color: Tone | null;
    }
  | {
      kind: "settlement";
      id: string;
      date: string;
      from_member_id: string;
      to_member_id: string;
      amount_cents: number;
      note: string | null;
    };

export type ExpenseSummary = {
  /** Positief: krijgt nog geld. Negatief: moet nog betalen. Samen altijd 0. */
  balances: { member_id: string; balance_cents: number }[];
  transfers: Transfer[];
  month: {
    month: string; // YYYY-MM
    total_cents: number;
    by_category: { category_id: string | null; name: string; color: Tone | null; total_cents: number }[];
    by_member: { member_id: string; share_cents: number }[];
  };
  entries: ExpenseEntry[];
};

// ---------- voorraad ----------

export const ITEM_TYPES = {
  consumable: { label: "Verbruik", hint: "Eten, schoonmaak, verzorging: raakt op" },
  asset: { label: "Bezit", hint: "Toestellen, gereedschap, meubels: blijft" },
} as const;
export type ItemType = keyof typeof ITEM_TYPES;

export function isItemType(value: unknown): value is ItemType {
  return typeof value === "string" && Object.hasOwn(ITEM_TYPES, value);
}

/** Eenheden met hun meervoud, zodat de app "3 flessen" kan zeggen. */
export const UNITS = {
  stuk: "stuks",
  pak: "pakken",
  fles: "flessen",
  blik: "blikken",
  pot: "potten",
  doos: "dozen",
  zak: "zakken",
  rol: "rollen",
  tube: "tubes",
  kg: "kg",
  g: "g",
  l: "l",
  ml: "ml",
} as const;
export type Unit = keyof typeof UNITS;

export function isUnit(value: unknown): value is Unit {
  return typeof value === "string" && Object.hasOwn(UNITS, value);
}

export type Item = {
  id: string;
  name: string;
  type: ItemType;
  category_id: string | null;
  default_location_id: string | null;
  unit: Unit;
  barcode: string | null;
  brand: string | null;
  /** Waar je het meestal koopt. */
  vendor_id: string | null;
  min_quantity: number | null;
  notes: string | null;
  archived: 0 | 1;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type StockLevel = { location_id: string; quantity: number; next_expiry: string | null };

export type ItemListItem = Item & {
  category_name: string | null;
  category_color: Tone | null;
  levels: StockLevel[];
  tag_ids: string[];
  quantity: number;
  next_expiry: string | null;
};

export const MOVEMENT_REASONS = {
  purchase: "Gekocht",
  add: "Toegevoegd",
  consume: "Verbruikt",
  discard: "Weggegooid",
  adjust: "Geteld",
  move: "Verplaatst",
} as const;
export type MovementReason = keyof typeof MOVEMENT_REASONS;

export type StockMovement = {
  id: string;
  item_id: string;
  location_id: string | null;
  location_name: string | null;
  delta: number;
  reason: MovementReason;
  purchase_id: string | null;
  purchase_description: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  expires_on: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
};

export type ItemDetail = ItemListItem & {
  movements: StockMovement[];
  purchases: { id: string; description: string; purchased_on: string; warranty_until: string | null }[];
};

export type ItemInput = Pick<
  Item,
  "name" | "type" | "category_id" | "default_location_id" | "unit" | "barcode" | "brand" | "min_quantity" | "notes"
> & {
  /** Naam van de verkoper waar je het meestal koopt. */
  vendor: string | null;
  tag_ids: string[];
  /** Enkel bij een nieuw item: wat er nu al is. */
  initial?: { quantity: number; location_id: string | null; expires_on: string | null; purchase_id: string | null };
};

export const STOCK_ACTIONS = ["add", "consume", "discard", "count", "move"] as const;
export type StockAction = (typeof STOCK_ACTIONS)[number];

export type StockActionInput = {
  action: StockAction;
  quantity: number;
  /** Bij "move": de plaats waar het nu ligt. Leeg = de server kiest (bv. wat eerst vervalt). */
  location_id?: string | null;
  to_location_id?: string | null;
  expires_on?: string | null;
  purchase_id?: string | null;
  /** Bij "add": waar het gekocht werd (naam). */
  vendor?: string | null;
  note?: string | null;
};

export type ProductSuggestion = {
  name: string | null;
  brand: string | null;
  quantity_text: string | null;
  category_id: string | null;
  source: "openfoodfacts";
};

export type BarcodeLookup = { item_id: string | null; suggestion: ProductSuggestion | null };

// ---------- klantenkaarten ----------

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
