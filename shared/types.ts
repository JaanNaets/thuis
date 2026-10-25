// Types die zowel de Worker (API) als de React-app gebruiken.

import type { DefaultSplit, PaymentInput, SplitInput, SplitLine, SplitMode } from "./split";
import type { VendorKind } from "./vendor";

// ---------- algemeen ----------

/** De pastelkleuren van de app. Categorieën, tags en leden krijgen er een van. */
export const TONES = ["peach", "butter", "sage", "mint", "sky", "lilac", "rose"] as const;
export type Tone = (typeof TONES)[number];

export function isTone(value: unknown): value is Tone {
  return typeof value === "string" && (TONES as readonly string[]).includes(value);
}

/** Tellers voor de navigatie. */
export type Stats = {
  purchases: number;
  /** Verbruik (voorraad). */
  items: number;
  /** Bezit. */
  assets: number;
  low: number;
  expiring: number;
  cards: number;
  vendors: number;
  projects: number;
};

// ---------- huishoudens en toegang ----------

/**
 * Toegang van een lid:
 * - full: alles in dit huishouden;
 * - projects: enkel de projecten waarin die zit (bv. vrienden op skireis).
 */
export const ACCESS_LEVELS = {
  full: { label: "Alles", hint: "Ziet en beheert alles in dit huishouden" },
  projects: { label: "Enkel projecten", hint: "Ziet enkel de projecten waarin die zit" },
} as const;
export type Access = keyof typeof ACCESS_LEVELS;

export type Household = {
  id: string;
  name: string;
  default_split: DefaultSplit | null;
};

/** Een huishouden waar jij lid van bent, met jouw lidmaatschap. */
export type HouseholdAccess = Household & { member: Member };

export type Me = { email: string; households: HouseholdAccess[] };

// ---------- huishouden en indeling ----------

export type Member = {
  id: string;
  household_id: string;
  name: string;
  /** Waarmee die aanmeldt; leeg = meldt niet aan. */
  email: string | null;
  color: Tone | null;
  /** Woont hier: deelt mee in de uitgaven van het huishouden. */
  active: 0 | 1;
  access: Access;
  created_at: string;
};

export type MemberInput = Pick<Member, "name" | "email" | "color" | "active" | "access">;

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
  kind: VendorKind | null;
  /** Wat je er meestal koopt (uitgavencategorie); een nieuwe aankoop krijgt die alvast. */
  category_id: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  /** Je account daar. Nooit een wachtwoord. */
  customer_number: string | null;
  account_member_id: string | null;
  account_login: string | null;
  /** Ondernemingsnummer (genormaliseerd, zie shared/vendor.ts) en IBAN zonder spaties. */
  company_number: string | null;
  iban: string | null;
  /** Verandert bij elk nieuw logo; null = geen logo. */
  logo_version: number | null;
  /** Aantal aankopen bij deze verkoper. */
  usage: number;
};

export type VendorInput = Omit<Vendor, "id" | "usage" | "logo_version">;

export type VendorListItem = Vendor & {
  category_name: string | null;
  total_cents: number;
  last_purchase_on: string | null;
  card_count: number;
};

/** Een vestiging: Colruyt Halle, Colruyt Lembeek, ... */
export type VendorBranch = {
  id: string;
  vendor_id: string;
  name: string;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  opening_hours: string | null;
  notes: string | null;
  sort_order: number;
};

export type VendorBranchInput = Omit<VendorBranch, "id" | "vendor_id" | "sort_order">;

export type VendorContact = {
  id: string;
  vendor_id: string;
  branch_id: string | null;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  sort_order: number;
};

export type VendorContactInput = Omit<VendorContact, "id" | "vendor_id" | "sort_order">;

export type VendorDetail = Vendor & {
  category_name: string | null;
  category_color: Tone | null;
  purchase_count: number;
  total_cents: number;
  /** Uitgegeven per jaar, nieuwste eerst. */
  totals: { year: string; total_cents: number; count: number }[];
  branches: VendorBranch[];
  contacts: VendorContact[];
  cards: LoyaltyCard[];
  /** De recentste aankopen (hoogstens 50). */
  purchases: PurchaseListItem[];
  /** Aankopen waarvan de garantie nog loopt. */
  warranties: PurchaseListItem[];
  /** Items die je hier meestal koopt. */
  items: { id: string; name: string; quantity: number; unit: Unit; category_name: string | null; category_color: Tone | null }[];
  /** Wat er recent van hier in de voorraad kwam. */
  movements: { id: string; item_id: string; item_name: string; delta: number; unit: Unit; created_at: string; location_name: string | null }[];
};

export type Tag = {
  id: string;
  name: string;
  color: Tone | null;
  /** Aan hoeveel dingen de tag hangt. */
  usage: number;
};

/** Alles wat formulieren nodig hebben om iets in te delen, in één aanvraag (voor het gekozen huishouden). */
export type Taxonomy = {
  /** Wie nu aangemeld is (het lid in dit huishouden). */
  me: Member;
  household: Household;
  members: Member[];
  categories: Category[];
  locations: Location[];
  tags: Tag[];
  vendors: Vendor[];
  /** Projecten die jij mag zien. */
  projects: Project[];
  pots: Pot[];
};

// ---------- projecten en potten ----------

export type Project = {
  id: string;
  household_id: string;
  name: string;
  description: string | null;
  color: Tone | null;
  start_on: string | null;
  end_on: string | null;
  budget_cents: number | null;
  /** 1 = eigen saldo; 0 = telt mee in het saldo van het huishouden. */
  separate_balance: 0 | 1;
  default_split: DefaultSplit | null;
  archived: 0 | 1;
  created_by: string;
  created_at: string;
  /** Deelnemers. */
  member_ids: string[];
};

export type ProjectInput = Pick<
  Project,
  "name" | "description" | "color" | "start_on" | "end_on" | "budget_cents" | "separate_balance" | "default_split" | "member_ids"
>;

export type ProjectListItem = Project & { total_cents: number; expense_count: number; last_expense_on: string | null };

/** Een pot: gezamenlijke rekening, spaarpot of reiskas. */
export type Pot = {
  id: string;
  household_id: string;
  project_id: string | null;
  name: string;
  color: Tone | null;
  opening_cents: number;
  archived: 0 | 1;
};

export type PotInput = Pick<Pot, "name" | "color" | "opening_cents" | "project_id">;

// ---------- aankopen en uitgaven ----------

export type { DefaultSplit, PaymentInput, SplitInput, SplitLine, SplitMode };

export type ExpenseShare = { member_id: string; share_cents: number };

export type Purchase = {
  id: string;
  household_id: string;
  project_id: string | null;
  description: string;
  vendor_id: string | null;
  purchased_on: string;
  amount_cents: number | null;
  category_id: string | null;
  /** Hoe het bedrag verdeeld is; leeg = niet verdeeld (bv. enkel uit een pot betaald, van vroeger). */
  split_mode: SplitMode | null;
  /** Ingeboekt door een terugkerende kost. */
  recurring_id: string | null;
  warranty_until: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
};

export type PurchaseListItem = Purchase & {
  vendor_name: string | null;
  category_name: string | null;
  category_color: Tone | null;
  project_name: string | null;
  file_count: number;
  thumbnail_file_id: string | null;
  payments: PaymentInput[];
};

export type PurchaseFile = {
  id: string;
  purchase_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

export type PurchaseDetail = PurchaseListItem & {
  files: PurchaseFile[];
  shares: (ExpenseShare & { split_value: number | null })[];
  lines: SplitLine[];
  tag_ids: string[];
  /** De dingen waar deze uitgave aan hangt. */
  links: (Pick<ItemLink, "id" | "item_id" | "role" | "quantity" | "amount_cents" | "note"> & { item_name: string; item_type: ItemType; unit: Unit })[];
};

export type PurchaseInput = Pick<Purchase, "description" | "purchased_on" | "amount_cents" | "category_id" | "project_id" | "warranty_until" | "notes"> & {
  /** Naam van de verkoper; een nieuwe naam wordt meteen een nieuwe verkoper. */
  vendor: string | null;
  /** Wie betaalde. Leeg mag enkel als er geen bedrag is. */
  payments: PaymentInput[];
  /** Hoe het verdeeld wordt; leeg = niet verdelen. */
  split: SplitInput | null;
  tag_ids: string[];
};

/** Soorten geldbewegingen. */
export const TRANSFER_KINDS = {
  repayment: { label: "Terugbetaling" },
  loan: { label: "Lening" },
  deposit: { label: "Storting" },
  withdrawal: { label: "Afhaling" },
} as const;
export type TransferKind = keyof typeof TRANSFER_KINDS;

/** Geld van iemand (of een pot) naar iemand anders (of een pot). */
export type MoneyTransfer = {
  id: string;
  household_id: string;
  project_id: string | null;
  kind: TransferKind;
  from_member_id: string | null;
  from_pot_id: string | null;
  to_member_id: string | null;
  to_pot_id: string | null;
  amount_cents: number;
  transferred_on: string;
  note: string | null;
  created_by: string;
  created_at: string;
};

export type MoneyTransferInput = Pick<
  MoneyTransfer,
  "project_id" | "kind" | "from_member_id" | "from_pot_id" | "to_member_id" | "to_pot_id" | "amount_cents" | "transferred_on" | "note"
>;

/** Een voorgestelde overschrijving om iedereen op nul te zetten. */
export type Transfer = { from: string; to: string; amount_cents: number };

export const FREQUENCIES = {
  weekly: { label: "Elke week", short: "wekelijks" },
  monthly: { label: "Elke maand", short: "maandelijks" },
  quarterly: { label: "Elk kwartaal", short: "per kwartaal" },
  yearly: { label: "Elk jaar", short: "jaarlijks" },
} as const;
export type Frequency = keyof typeof FREQUENCIES;

export type RecurringExpense = {
  id: string;
  household_id: string;
  project_id: string | null;
  description: string;
  amount_cents: number;
  category_id: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  frequency: Frequency;
  /** Eerste keer; elke volgende keer wordt hiervan berekend. */
  start_on: string;
  /** Volgende keer dat de uitgave vanzelf ingeboekt wordt. */
  next_on: string;
  end_on: string | null;
  payments: PaymentInput[];
  split: SplitInput;
  notes: string | null;
  active: 0 | 1;
  created_at: string;
};

export type RecurringInput = Pick<
  RecurringExpense,
  "project_id" | "description" | "amount_cents" | "category_id" | "frequency" | "start_on" | "end_on" | "payments" | "split" | "notes" | "active"
> & { vendor: string | null };

export type ExpenseEntry =
  | {
      kind: "purchase";
      id: string;
      date: string;
      description: string;
      amount_cents: number | null;
      payments: PaymentInput[];
      split_mode: SplitMode | null;
      category_name: string | null;
      category_color: Tone | null;
      project_name: string | null;
      recurring_id: string | null;
    }
  | ({ kind: "transfer"; date: string } & Omit<MoneyTransfer, "kind" | "transferred_on"> & { transfer_kind: TransferKind });

export type PotSummary = Pot & {
  cash_cents: number;
  /** Per lid: gestort − afgehaald − verbruikt. Negatief = moet nog bijstorten. */
  members: { member_id: string; balance_cents: number }[];
};

/** Saldo's en een maandoverzicht, voor het huishouden of voor één project met een eigen saldo. */
export type ExpenseSummary = {
  project_id: string | null;
  /** Positief: krijgt nog geld. Negatief: moet nog betalen. Samen altijd 0. */
  balances: { member_id: string; balance_cents: number }[];
  transfers: Transfer[];
  pots: PotSummary[];
  month: {
    month: string; // YYYY-MM
    total_cents: number;
    by_category: { category_id: string | null; name: string; color: Tone | null; total_cents: number }[];
    by_member: { member_id: string; share_cents: number }[];
  };
  entries: ExpenseEntry[];
  recurring: RecurringExpense[];
};

/** Wat buiten de projecten met jou gedeeld werd (vooral voor een gast): je saldo, wie wie moet, en de uitgaven. */
export type SharedSummary = {
  balance_cents: number;
  /** Enkel de overschrijvingen waar jij in zit. */
  transfers: Transfer[];
  entries: ExpenseEntry[];
  /** Jouw deel per uitgave (purchase id → cent). */
  my_shares: Record<string, number>;
};

/** Een project met alles wat de projectpagina toont. */
export type ProjectDetail = ProjectListItem & {
  members: Member[];
  by_category: { category_id: string | null; name: string; color: Tone | null; total_cents: number }[];
  /** Enkel bij een eigen saldo. */
  summary: Omit<ExpenseSummary, "month" | "recurring" | "entries"> | null;
  /** Uitgaven en geldbewegingen van het project, nieuwste eerst. */
  entries: ExpenseEntry[];
  recurring: RecurringExpense[];
};

// ---------- voorraad ----------

export const ITEM_TYPES = {
  consumable: { label: "Verbruik", hint: "Eten, schoonmaak, pellets: raakt op" },
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

/** Hoe een bezit in huis kwam. */
export const ITEM_ORIGINS = {
  bought: { label: "Gekocht" },
  gift: { label: "Gekregen" },
  had: { label: "Had ik al" },
} as const;
export type ItemOrigin = keyof typeof ITEM_ORIGINS;

/** Inhoud per eenheid, om prijzen te vergelijken (15 kg per zak). */
export const CONTENT_UNITS = ["kg", "g", "l", "ml"] as const;
export type ContentUnit = (typeof CONTENT_UNITS)[number];

/** Waarom een uitgave aan een ding hangt. */
export const LINK_ROLES = {
  purchase: { label: "Aankoop", hint: "Dit ding zelf gekocht" },
  refill: { label: "Bijgekocht", hint: "De voorraad aangevuld" },
  maintenance: { label: "Onderhoud", hint: "Kuisbeurt, nazicht, …" },
  repair: { label: "Herstelling", hint: "Iets kapot laten maken" },
  part: { label: "Onderdeel", hint: "Onderdeel of toebehoren" },
  other: { label: "Andere kost", hint: "Iets anders voor dit ding" },
} as const;
export type LinkRole = keyof typeof LINK_ROLES;

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
  /** Bij bezit: "goed om te weten" (instellingen, tips). */
  notes: string | null;
  /** Hoort bij een ander ding (pellets bij de kachel). */
  parent_id: string | null;
  origin: ItemOrigin | null;
  /** Van wie gekregen, waar het vandaan komt. */
  origin_note: string | null;
  acquired_on: string | null;
  /** Geschatte waarde, als het niet gekocht is. */
  value_cents: number | null;
  content_amount: number | null;
  content_unit: ContentUnit | null;
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
  /** Alles wat er ooit aan uitgegeven werd (aankoop, onderhoud, bijkopen, …). */
  cost_cents: number;
  /** De langste garantie van de aankopen eraan. */
  warranty_until: string | null;
  /** Waar het gekocht werd (de aankoop zelf). */
  bought_at: string | null;
};

/** Een uitgave die aan een ding hangt, met wat je van die uitgave nodig hebt. */
export type ItemLink = {
  id: string;
  item_id: string;
  purchase_id: string;
  role: LinkRole;
  quantity: number | null;
  /** Wat dit ding ervan kostte; leeg = het hele bedrag van de uitgave. */
  amount_cents: number | null;
  note: string | null;
  description: string;
  purchased_on: string;
  vendor_id: string | null;
  vendor_name: string | null;
  purchase_amount_cents: number | null;
  warranty_until: string | null;
};

export type ItemLinkInput = Pick<ItemLink, "purchase_id" | "role" | "quantity" | "amount_cents" | "note"> & {
  /** Bij bijkopen: meteen in voorraad zetten (op deze plaats, of de standaardplaats). */
  add_stock?: boolean;
  location_id?: string | null;
};

export type ItemLogEntry = { id: string; item_id: string; happened_on: string; text: string; created_by: string; created_at: string };

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
  /** Uitgaven aan dit ding, nieuwste eerst. */
  links: ItemLink[];
  log: ItemLogEntry[];
  parent: { id: string; name: string; type: ItemType } | null;
  /** Wat erbij hoort. */
  children: ItemListItem[];
};

export type ItemInput = Pick<
  Item,
  | "name"
  | "type"
  | "category_id"
  | "default_location_id"
  | "unit"
  | "barcode"
  | "brand"
  | "min_quantity"
  | "notes"
  | "parent_id"
  | "origin"
  | "origin_note"
  | "acquired_on"
  | "value_cents"
  | "content_amount"
  | "content_unit"
> & {
  /** Naam van de verkoper waar je het meestal koopt. */
  vendor: string | null;
  tag_ids: string[];
  /** Enkel bij een nieuw item: wat er nu al is. */
  initial?: {
    quantity: number;
    location_id: string | null;
    expires_on: string | null;
    /** Uit deze aankoop: het item wordt eraan gekoppeld (bezit: de aankoop zelf, verbruik: bijgekocht). */
    purchase_id: string | null;
    /** Wat het item van die aankoop kostte; leeg = het hele bedrag. */
    amount_cents?: number | null;
  };
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
  /** De winkel waar de kaart bij hoort. */
  vendor_id: string | null;
  created_by: string;
  created_at: string;
};

export type LoyaltyCardInput = Pick<LoyaltyCard, "name" | "card_number" | "format" | "color" | "notes" | "vendor_id">;

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
