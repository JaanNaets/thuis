// Sjablonen voor een nieuwe lijst: een vertrekpunt met velden, een voorraad als ze telt, eigen soorten voor haar
// logboek en wie een melding krijgt. Zo weinig mogelijk: een lijst uit een sjabloon is een gewone lijst, de rest voeg je
// zelf toe (Instellen). Een lijst kan ook uit een bestand komen (`shared/template-file.ts`, Uit bestand).

import type { Handeling } from "./cells.ts";
import type { NotifyDef } from "./alerts.ts";
import type { FieldDef } from "./fields.ts";
import type { IconKey } from "./icons.ts";
import type { LedgerDef } from "./ledger.ts";
import type { Base, Parts } from "./model.ts";
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
  /** Hoe één ding heet; null = enkel een logboek. */
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
    one: "Ding",
    icon: "folder",
    fields: [note],
  },
  {
    // Zoals Splitwise: een rij per persoon met zijn saldo (wie betaalde krijgt erbij, wie deelt zijn deel eraf), gelijk
    // verdeeld over wie erbij is (`defaultSharers`), Wie moet wie en Terugbetaald; een melding aan wie in de verdeling staat.
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
      { base: "aankoop", name: "Aankoop", icon: "cart" },
      { base: "overdracht", name: "Terugbetaling", icon: "transfer" },
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
