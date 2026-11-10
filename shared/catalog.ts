// Sjablonen voor een nieuwe lijst: een vertrekpunt met velden, een voorraad als ze telt, eigen soorten voor haar
// logboek en wie een melding krijgt. Zo weinig mogelijk: een lijst uit een sjabloon is een gewone lijst, de rest voeg je
// zelf toe (Instellen). Een lijst kan ook uit een bestand komen (`shared/template-file.ts`, Uit bestand).

import type { NotifyDef } from "./alerts.ts";
import type { FieldDef } from "./fields.ts";
import type { IconKey } from "./icons.ts";
import type { Base } from "./model.ts";
import type { StockDef } from "./stock.ts";

export type KindTemplate = { base: Base; name: string; icon?: IconKey; fields?: FieldDef[]; goal?: number; planned?: true };

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
    // Zoals Splitwise: wie betaalde, gelijk verdeeld over wie erbij is (`defaultSharers`), Wie moet wie en Terugbetaald;
    // een melding aan wie in de verdeling staat.
    key: "uitgaven",
    name: "Uitgaven",
    one: null,
    icon: "wallet",
    fields: [],
    kinds: [{ base: "aankoop", name: "Aankoop", icon: "cart" }],
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
