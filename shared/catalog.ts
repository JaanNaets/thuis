// Sjablonen voor een nieuwe lijst: een vertrekpunt met velden, een voorraad als ze telt, formulieren die erin loggen
// en wie daarvan een melding krijgt. Zo weinig mogelijk: een lijst uit een sjabloon is een gewone lijst met gewone
// formulieren, de rest voeg je zelf toe (Instellen). Een sjabloon zonder items (`one` leeg) maakt enkel zijn
// formulieren. Een lijst kan ook uit een bestand komen (`shared/template-file.ts`, Uit bestand).

import { presetDoes, type Handeling } from "./cells.ts";
import type { NotifyDef } from "./alerts.ts";
import type { FieldDef } from "./fields.ts";
import type { IconKey } from "./icons.ts";
import type { LedgerDef } from "./ledger.ts";
import { baseParts, type Base, type Parts } from "./model.ts";
import type { StockDef } from "./stock.ts";

/**
 * Een formulier: zijn vertrekpunt, naam, velden, onderdelen (`parts`, een groep uit een lijst enkel uit de lijst zelf:
 * "self"; leeg = die van het vertrekpunt) en wat het invult (`does`, enkel in de lijst zelf of de voorraad van elke lijst).
 */
export type KindTemplate = { base: Base; name: string; icon?: IconKey; fields?: FieldDef[]; goal?: number; planned?: true; parts?: Parts; does?: Handeling[] };

export type ListTemplate = {
  key: string;
  /** De naam van een nieuwe lijst als je er geen typt. */
  name: string;
  /** Hoe het sjabloon heet in de kiezer; anders de naam. */
  label?: string;
  /** Hoe één item heet; null = geen lijst, enkel de formulieren. */
  one: string | null;
  icon: IconKey;
  fields: FieldDef[];
  stock?: StockDef;
  /** Een saldo per persoon (Wie moet wie). */
  ledger?: LedgerDef;
  kinds?: KindTemplate[];
  notify?: NotifyDef;
};

const note: FieldDef = { key: "notitie", label: "Notitie", type: "longtext" };

export const TEMPLATES: ListTemplate[] = [
  {
    key: "leeg",
    name: "Lijst",
    label: "Lege lijst",
    one: "Item",
    icon: "folder",
    fields: [note],
  },
  {
    // Zoals Splitwise: een rij per persoon met zijn saldo (wie betaalde krijgt erbij, wie deelt zijn deel eraf: de
    // handelingen op deze lijst), gelijk verdeeld over wie erbij is (`defaultSharers`), Wie moet wie en Terugbetaald;
    // een melding aan wie in de verdeling staat.
    key: "uitgaven",
    name: "Uitgaven",
    one: "Persoon",
    icon: "wallet",
    fields: [
      { key: "persoon", label: "Persoon", type: "person" },
      { key: "saldo", label: "Saldo", type: "money", column: true },
    ],
    ledger: { person: "persoon", field: "saldo" },
    kinds: [
      { base: "aankoop", name: "Aankoop", icon: "cart", parts: baseParts("aankoop"), does: presetDoes("aankoop", "self") },
      { base: "overdracht", name: "Terugbetaling", icon: "transfer", parts: baseParts("overdracht"), does: presetDoes("overdracht", "self") },
    ],
    notify: { to: "people" },
  },
  {
    // Zoals Yazio: wat je at met de kcal (NEVO of Open Food Facts vult ze in) en je gewicht.
    key: "dieet",
    name: "Dieet",
    one: null,
    icon: "food",
    fields: [],
    kinds: [
      { base: "gebruik", name: "Gegeten", icon: "food", fields: [{ key: "kcal", label: "Kcal", type: "number", product: "kcal", unit: "kcal" }] },
      { base: "meting", name: "Gewicht", icon: "weight", fields: [{ key: "waarde", label: "Gewicht", type: "number", unit: "kg" }] },
    ],
  },
];

export const templateByKey = (key: string | null | undefined) => TEMPLATES.find((t) => t.key === key);
