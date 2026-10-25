// Sjablonen: een goed vertrekpunt voor een nieuw project. Ze zetten lijsten met velden klaar; daarna kan je alles
// aanpassen. Er is niets speciaals aan: een project uit een sjabloon is een gewoon project.

import type { FieldDef } from "./fields";

/** Iconen voor projecten en lijsten (namen uit src/components/Icon.tsx). */
export const ICONS = [
  "home",
  "project",
  "wine",
  "bike",
  "armchair",
  "package",
  "card",
  "store",
  "pin",
  "receipt",
  "wallet",
  "tag",
  "users",
  "folder",
  "note",
  "star",
  "image",
  "clock",
  "sparkles",
] as const;
export type IconKey = (typeof ICONS)[number];

export function isIconKey(value: unknown): value is IconKey {
  return typeof value === "string" && (ICONS as readonly string[]).includes(value);
}

/** Een veld in een sjabloon: een verwijzing wijst naar een andere lijst via haar sleutel (`ref`). */
export type TemplateField = Omit<FieldDef, "ref_type"> & { ref?: string };

export type TypeTemplate = {
  key: string;
  name: string;
  plural: string;
  name_label?: string;
  icon: IconKey;
  fields: TemplateField[];
};

export type ProjectTemplate = {
  label: string;
  description: string;
  icon: IconKey;
  types: TypeTemplate[];
};

const NOTE: TemplateField = { key: "notitie", label: "Notitie", type: "longtext" };
const OWNER: TemplateField = { key: "eigenaar", label: "Eigenaar", type: "share", hint: "Van wie is het (leeg = samen)" };

const PLACE: TypeTemplate = {
  key: "plaats",
  name: "Plaats",
  plural: "Plaatsen",
  icon: "pin",
  fields: [{ key: "ligt_in", label: "Ligt in", type: "item", ref: "plaats", column: true }],
};

const VENDOR: TypeTemplate = {
  key: "verkoper",
  name: "Verkoper",
  plural: "Verkopers",
  icon: "store",
  fields: [
    { key: "website", label: "Website", type: "text", column: true },
    { key: "telefoon", label: "Telefoon", type: "text" },
    { key: "email", label: "E-mail", type: "text" },
    { key: "adres", label: "Adres", type: "longtext" },
    { key: "klantnummer", label: "Klantnummer", type: "text", hint: "Nooit een wachtwoord" },
    NOTE,
  ],
};

const EXPENSE: TypeTemplate = {
  key: "uitgave",
  name: "Uitgave",
  plural: "Uitgaven",
  name_label: "Omschrijving",
  icon: "receipt",
  fields: [
    { key: "bedrag", label: "Bedrag", type: "money", required: true, column: true },
    { key: "datum", label: "Datum", type: "date", required: true, column: true },
    { key: "betaald_door", label: "Betaald door", type: "person", column: true, filter: true },
    { key: "verkoper", label: "Verkoper", type: "item", ref: "verkoper", filter: true },
    {
      key: "categorie",
      label: "Categorie",
      type: "select",
      options: ["Boodschappen", "Wonen", "Energie", "Vervoer", "Gezondheid", "Vrije tijd", "Kleding", "Andere"],
      filter: true,
    },
    { key: "verdeling", label: "Verdeling", type: "share", hint: "Wie draagt hoeveel (leeg = gelijk)" },
    NOTE,
  ],
};

export const PROJECT_TEMPLATES = {
  empty: {
    label: "Leeg project",
    description: "Begin van nul en stel zelf je lijsten en velden samen",
    icon: "project",
    types: [],
  },
  household: {
    label: "Huishouden",
    description: "Wat je hebt, je voorraad, klantenkaarten, verkopers, plaatsen en uitgaven",
    icon: "home",
    types: [
      {
        key: "ding",
        name: "Ding",
        plural: "Bezit",
        icon: "armchair",
        fields: [
          { key: "merk", label: "Merk", type: "text", column: true },
          { key: "plaats", label: "Plaats", type: "item", ref: "plaats", column: true, filter: true },
          { key: "gekocht_bij", label: "Gekocht bij", type: "item", ref: "verkoper" },
          { key: "gekocht_op", label: "Gekocht op", type: "date" },
          { key: "prijs", label: "Prijs", type: "money" },
          { key: "garantie_tot", label: "Garantie tot", type: "date" },
          OWNER,
          { key: "goed_om_te_weten", label: "Goed om te weten", type: "longtext" },
        ],
      },
      {
        key: "product",
        name: "Product",
        plural: "Voorraad",
        icon: "package",
        fields: [
          { key: "aantal", label: "Aantal", type: "number", column: true },
          { key: "eenheid", label: "Eenheid", type: "select", options: ["stuk", "fles", "pak", "doos", "zak", "pot", "blik", "kg", "l"] },
          { key: "bijna_op", label: "Bijna op onder", type: "number" },
          { key: "plaats", label: "Plaats", type: "item", ref: "plaats", column: true, filter: true },
          { key: "barcode", label: "Barcode", type: "code", format: "ean_13" },
          NOTE,
        ],
      },
      {
        key: "kaart",
        name: "Kaart",
        plural: "Klantenkaarten",
        name_label: "Winkel of naam",
        icon: "card",
        fields: [
          { key: "code", label: "Code", type: "code", format: "code_128", required: true },
          { key: "winkel", label: "Winkel", type: "item", ref: "verkoper" },
          { key: "op_naam_van", label: "Op naam van", type: "person", column: true, filter: true },
          NOTE,
        ],
      },
      EXPENSE,
      VENDOR,
      PLACE,
    ],
  },
  wine: {
    label: "Wijnkelder",
    description: "Elke wijn met jaargang, druiven, streek, drinkvenster en proefnotities",
    icon: "wine",
    types: [
      {
        key: "wijn",
        name: "Wijn",
        plural: "Wijnen",
        icon: "wine",
        fields: [
          { key: "wijnhuis", label: "Wijnhuis", type: "text", column: true, hint: "producent of domein op het etiket" },
          { key: "jaargang", label: "Jaargang", type: "year", column: true, hint: "jaartal van de oogst op het etiket" },
          { key: "kleur", label: "Kleur", type: "select", options: ["Rood", "Wit", "Rosé", "Mousserend", "Zoet", "Versterkt"], filter: true },
          { key: "druiven", label: "Druiven", type: "multi", filter: true, hint: "druivenrassen, zoals Pinot Noir of Chardonnay" },
          { key: "land", label: "Land", type: "text", filter: true },
          { key: "streek", label: "Streek", type: "text", filter: true, hint: "streek of appellatie, zoals Bourgogne of Chablis" },
          { key: "inhoud", label: "Inhoud", type: "select", options: ["37,5 cl", "50 cl", "75 cl", "1,5 l", "3 l"] },
          { key: "drinken", label: "Drinken", type: "year_range", filter: true },
          { key: "prijs", label: "Aankoopprijs per fles", type: "money" },
          { key: "aantal", label: "Aantal", type: "number", column: true },
          { key: "score", label: "Score", type: "score" },
          OWNER,
          { key: "proefnotities", label: "Proefnotities", type: "longtext" },
        ],
      },
    ],
  },
  bikes: {
    label: "Koersfietsen",
    description: "Fietsen met bouwjaar, maat, groep, kilometers en onderhoud",
    icon: "bike",
    types: [
      {
        key: "fiets",
        name: "Fiets",
        plural: "Fietsen",
        icon: "bike",
        fields: [
          { key: "merk", label: "Merk", type: "text", column: true },
          { key: "bouwjaar", label: "Bouwjaar", type: "year", column: true },
          { key: "framemaat", label: "Framemaat", type: "text" },
          { key: "groep", label: "Groep", type: "text", filter: true, hint: "het schakelsysteem, zoals Shimano Ultegra" },
          { key: "km", label: "Kilometerstand", type: "number", unit: "km" },
          { key: "serienummer", label: "Serienummer", type: "text" },
          { key: "waarde", label: "Waarde", type: "money" },
          OWNER,
          NOTE,
        ],
      },
    ],
  },
  expenses: {
    label: "Gedeelde uitgaven",
    description: "Een reis, verbouwing of feest: wie betaalde wat en hoe het verdeeld wordt",
    icon: "wallet",
    types: [EXPENSE, VENDOR],
  },
  collection: {
    label: "Verzameling",
    description: "Platen, strips, gereedschap: kies zelf welke velden je bijhoudt",
    icon: "folder",
    types: [{ key: "stuk", name: "Stuk", plural: "Stukken", icon: "folder", fields: [OWNER, NOTE] }],
  },
} as const satisfies Record<string, ProjectTemplate>;
export type TemplateKey = keyof typeof PROJECT_TEMPLATES;

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === "string" && Object.hasOwn(PROJECT_TEMPLATES, value);
}

/**
 * De velden van een lijst uit een sjabloon, met echte verwijzingen: eerst naar een lijst uit hetzelfde sjabloon,
 * anders naar een lijst met dezelfde naam erboven (een wijnkelder onder Huishouden verwijst naar zijn Verkopers).
 * Een verwijzing die nergens heen kan, valt weg.
 */
export function resolveTemplateFields(fields: readonly TemplateField[], typeIdByKey: Record<string, string>, typeIdByName: Record<string, string>): FieldDef[] {
  const out: FieldDef[] = [];
  for (const { ref, ...field } of fields) {
    if (field.type !== "item") {
      out.push({ ...field });
      continue;
    }
    const target = (ref && typeIdByKey[ref]) || (ref && typeIdByName[ref.toLowerCase()]);
    if (target) out.push({ ...field, ref_type: target });
  }
  return out;
}
