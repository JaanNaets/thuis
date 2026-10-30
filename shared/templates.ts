// Sjablonen: een goed vertrekpunt voor een nieuw project. Ze zetten lijsten met velden klaar; daarna kan je alles
// aanpassen. Er is niets speciaals aan: een project uit een sjabloon is een gewoon project.
//
// Een sjabloon kan ook een bestand zijn (zie shared/template-file.ts): een project dat iemand deelt, met dezelfde
// vorm als de ingebouwde sjablonen hieronder.

import { previewCalcs, type CalcList } from "./calc.ts";
import type { FieldDef } from "./fields.ts";
import type { TotalDef } from "./totals.ts";

/** Iconen voor projecten en lijsten (namen uit src/components/Icon.tsx). */
export const ICONS = [
  "home",
  "project",
  "wine",
  "food",
  "bike",
  "armchair",
  "package",
  "card",
  "store",
  "pin",
  "receipt",
  "wallet",
  "transfer",
  "tag",
  "users",
  "folder",
  "note",
  "star",
  "image",
  "clock",
  "sparkles",
  "repeat",
] as const;
export type IconKey = (typeof ICONS)[number];

export function isIconKey(value: unknown): value is IconKey {
  return typeof value === "string" && (ICONS as readonly string[]).includes(value);
}

/**
 * Een veld in een sjabloon: een verwijzing wijst naar een andere lijst via haar sleutel (`ref`); een samenvatting
 * van wat hiernaar verwijst ook (`calc.list` is dan een sleutel).
 */
export type TemplateField = Omit<FieldDef, "ref_type" | "result"> & { ref?: string };

export type TypeTemplate = {
  key: string;
  name: string;
  plural: string;
  name_label?: string;
  icon: IconKey;
  fields: TemplateField[];
  /** Samenvattingen op het project (zie shared/totals.ts); wat niet bij de velden past, valt weg. */
  totals?: TotalDef[];
  /**
   * Kwam mee in een gedeeld sjabloon omdat een andere lijst ernaar verwijst (bv. de Verkopers bij een Wijnkelder).
   * Staat er bij het importeren erboven al een lijst met dezelfde naam, dan wordt die gebruikt in plaats van een nieuwe.
   */
  linked?: boolean;
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
    { key: "website", label: "Website", type: "url", column: true },
    { key: "telefoon", label: "Telefoon", type: "phone" },
    { key: "email", label: "E-mail", type: "email" },
    { key: "adres", label: "Adres", type: "address" },
    { key: "klantnummer", label: "Klantnummer", type: "text", hint: "Nooit een wachtwoord" },
    // Wat je er uitgaf (als er een lijst Uitgaven is; anders valt dit weg).
    {
      key: "uitgegeven",
      label: "Uitgegeven",
      type: "calc",
      column: true,
      calc: { kind: "rollup", from: "backlinks", list: "uitgave", via: "verkoper", agg: "sum", field: "bedrag" },
    },
    {
      key: "laatst",
      label: "Laatste aankoop",
      type: "calc",
      calc: { kind: "rollup", from: "backlinks", list: "uitgave", via: "verkoper", agg: "max", field: "datum" },
    },
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
    { key: "datum", label: "Datum", type: "date", required: true, column: true, today: true },
    { key: "betaald_door", label: "Betaald door", type: "person", column: true, filter: true, me: true },
    { key: "verkoper", label: "Verkoper", type: "item", ref: "verkoper", filter: true },
    {
      key: "categorie",
      label: "Categorie",
      type: "select",
      options: ["Boodschappen", "Wonen", "Energie", "Vervoer", "Gezondheid", "Vrije tijd", "Kleding", "Andere"],
      filter: true,
    },
    { key: "verdeling", label: "Verdeling", type: "share", fill: true, hint: "Wie draagt hoeveel (leeg = de gewone verdeling, of gelijk)" },
    NOTE,
  ],
  // Wie moet wie: per persoon wat hij betaalde min zijn deel, met de subprojecten; en wat je per maand uitgeeft.
  totals: [
    { id: "saldo", agg: "sum", field: "bedrag", period: "all", by: "betaald_door", against: "verdeling", settle: true, scope: "tree" },
    { id: "maand", label: "Uitgaven per maand", agg: "sum", field: "bedrag", period: "month", date: "datum", by: "categorie" },
  ],
};

/** Geld dat iemand aan iemand anders gaf; samen met de uitgaven geeft dat wie wie nog hoeveel moet. */
export const SETTLEMENT: TypeTemplate = {
  key: "terugbetaling",
  name: "Terugbetaling",
  plural: "Terugbetalingen",
  name_label: "Omschrijving",
  icon: "transfer",
  fields: [
    { key: "bedrag", label: "Bedrag", type: "money", required: true, column: true },
    { key: "datum", label: "Datum", type: "date", required: true, column: true, today: true },
    { key: "van", label: "Van", type: "person", required: true, filter: true },
    { key: "aan", label: "Aan", type: "person", required: true, filter: true },
    NOTE,
  ],
  // Wat Van gaf, telt voor hem; wat Aan kreeg, tegen hem.
  totals: [{ id: "saldo", agg: "sum", field: "bedrag", period: "all", by: "van", against: "aan", settle: true, scope: "tree" }],
};

/** Wat je eet: een foto van de verpakking vult de naam en de kcal per 100 g in; de app rekent en telt per dag. */
const FOOD: TypeTemplate = {
  key: "eten",
  name: "Eten",
  plural: "Eten",
  name_label: "Wat",
  icon: "food",
  fields: [
    { key: "datum", label: "Datum", type: "date", required: true, today: true, column: true },
    { key: "maaltijd", label: "Maaltijd", type: "select", options: ["Ontbijt", "Middag", "Avond", "Tussendoor"], column: true, filter: true },
    {
      key: "kcal_100",
      label: "kcal per 100 g",
      type: "number",
      unit: "kcal",
      product: "kcal",
      hint: "energie uit de voedingstabel op de verpakking, per 100 g of 100 ml, in kcal (niet kJ)",
    },
    { key: "gram", label: "Hoeveel", type: "number", unit: "g", hint: "wat je at, in gram (niet de hele verpakking)" },
    { key: "kcal", label: "Kcal", type: "calc", unit: "kcal", column: true, calc: { kind: "formula", expr: "[kcal_100] * [gram] / 100" } },
    NOTE,
  ],
  totals: [{ id: "dag", agg: "sum", field: "kcal", period: "day", date: "datum" }],
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
          { key: "garantie", label: "Garantie nog", type: "calc", calc: { kind: "days_until", field: "garantie_tot" } },
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
          {
            key: "kopen",
            label: "Kopen",
            type: "calc",
            filter: true,
            hint: "Ja als het aantal op of onder Bijna op onder is",
            calc: { kind: "compare", op: "<=", a: { field: "aantal" }, b: { field: "bijna_op" } },
          },
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
      SETTLEMENT,
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
          { key: "waarde", label: "Waarde", type: "calc", calc: { kind: "math", op: "*", a: { field: "aantal" }, b: { field: "prijs" } } },
          { key: "leeftijd", label: "Leeftijd", type: "calc", calc: { kind: "since", field: "jaargang", unit: "year" } },
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
    types: [EXPENSE, SETTLEMENT, VENDOR],
  },
  food: {
    label: "Voeding",
    description: "Wat je eet en hoeveel kcal, per dag opgeteld. Een foto van de verpakking vult de voedingswaarde in",
    icon: "food",
    types: [FOOD],
  },
  collection: {
    label: "Verzameling",
    description: "Platen, strips, gereedschap: kies zelf welke velden je bijhoudt",
    icon: "folder",
    types: [{ key: "stuk", name: "Stuk", plural: "Stukken", icon: "folder", fields: [OWNER, NOTE] }],
  },
} as const satisfies Record<string, ProjectTemplate>;
export type TemplateKey = keyof typeof PROJECT_TEMPLATES;

/** Losse lijsten om aan een bestaand project toe te voegen (naast de lijsten uit de projectsjablonen). */
export const LIST_TEMPLATES: TypeTemplate[] = [
  {
    key: "onderhoud",
    name: "Onderhoud",
    plural: "Onderhoud",
    name_label: "Wat",
    icon: "clock",
    fields: [
      { key: "elke", label: "Om de", type: "interval", required: true, hint: "bv. elk jaar, elke 3 maanden" },
      { key: "laatst", label: "Laatst gedaan", type: "date", required: true },
      { key: "volgende", label: "Volgende keer", type: "calc", column: true, calc: { kind: "date_add", field: "laatst", add: { field: "elke" } } },
      { key: "nog", label: "Nog", type: "calc", column: true, calc: { kind: "days_until", field: "volgende" } },
      { key: "wie", label: "Wie doet het", type: "people", filter: true },
      { key: "duur", label: "Duurt", type: "duration" },
      { key: "stappen", label: "Stappen", type: "checklist" },
      NOTE,
    ],
  },
  {
    key: "abonnement",
    name: "Abonnement",
    plural: "Abonnementen",
    icon: "repeat",
    fields: [
      { key: "bedrag", label: "Bedrag", type: "money", required: true, column: true },
      { key: "elke", label: "Om de", type: "interval", required: true },
      { key: "betaald", label: "Laatst betaald", type: "date" },
      { key: "volgende", label: "Volgende betaling", type: "calc", column: true, calc: { kind: "date_add", field: "betaald", add: { field: "elke" } } },
      { key: "opzeggen", label: "Opzeggen voor", type: "date" },
      { key: "website", label: "Website", type: "url" },
      { key: "klantnummer", label: "Klantnummer", type: "text", hint: "Nooit een wachtwoord" },
      { key: "wie", label: "Op naam van", type: "person", filter: true },
      NOTE,
    ],
  },
  {
    key: "recept",
    name: "Recept",
    plural: "Recepten",
    icon: "note",
    fields: [
      { key: "bron", label: "Bron", type: "url" },
      { key: "personen", label: "Voor", type: "number", unit: "personen" },
      { key: "duur", label: "Bereiding", type: "duration", column: true },
      { key: "soort", label: "Soort", type: "select", options: ["Voorgerecht", "Hoofdgerecht", "Dessert", "Soep", "Bijgerecht", "Ontbijt"], filter: true },
      { key: "score", label: "Score", type: "score", column: true },
      { key: "ingredienten", label: "Ingrediënten", type: "checklist" },
      { key: "bereiding", label: "Bereiding", type: "longtext" },
    ],
  },
  {
    key: "reis",
    name: "Reis",
    plural: "Reizen",
    name_label: "Bestemming",
    icon: "pin",
    fields: [
      { key: "periode", label: "Periode", type: "date_range", column: true, filter: true },
      { key: "wie", label: "Wie gaat mee", type: "people", filter: true },
      { key: "vertrek", label: "Vertrek", type: "time" },
      { key: "budget", label: "Budget", type: "money" },
      { key: "logies", label: "Logies", type: "address" },
      { key: "paklijst", label: "Paklijst", type: "checklist" },
      NOTE,
    ],
  },
  {
    key: "contact",
    name: "Contact",
    plural: "Contacten",
    icon: "users",
    fields: [
      { key: "telefoon", label: "Telefoon", type: "phone", column: true },
      { key: "email", label: "E-mail", type: "email" },
      { key: "adres", label: "Adres", type: "address" },
      { key: "verjaardag", label: "Verjaardag", type: "date" },
      { key: "leeftijd", label: "Leeftijd", type: "calc", calc: { kind: "since", field: "verjaardag", unit: "year" } },
      { key: "soort", label: "Soort", type: "select", options: ["Familie", "Vrienden", "Buren", "Vakman", "Dokter", "Andere"], filter: true },
      NOTE,
    ],
  },
  {
    key: "taak",
    name: "Taak",
    plural: "Taken",
    icon: "star",
    fields: [
      { key: "tegen", label: "Tegen", type: "date", column: true },
      { key: "nog", label: "Nog", type: "calc", calc: { kind: "days_until", field: "tegen" } },
      { key: "wie", label: "Wie", type: "people", filter: true },
      { key: "klaar", label: "Klaar", type: "bool", filter: true },
      { key: "stappen", label: "Stappen", type: "checklist" },
      NOTE,
    ],
  },
];

/** Alle lijsten die je los kan toevoegen: de losse en die uit de projectsjablonen (elk één keer). */
export function listTemplates(): TypeTemplate[] {
  const all = [...LIST_TEMPLATES, ...Object.values(PROJECT_TEMPLATES).flatMap((t) => t.types as readonly TypeTemplate[])];
  return all.filter((t, i) => all.findIndex((x) => x.key === t.key) === i);
}

/** Eén lijst uit een sjabloon, op haar sleutel (om ze later aan een project toe te voegen). */
export function typeTemplate(key: unknown): TypeTemplate | undefined {
  return listTemplates().find((t) => t.key === key);
}

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === "string" && Object.hasOwn(PROJECT_TEMPLATES, value);
}

/** Een lijst uit een sjabloon die aangemaakt wordt: haar nieuwe id en de lijsten waarnaar ze mag wijzen. */
export type TemplatePlan = {
  id: string;
  list: TypeTemplate;
  /** Sleutel → id van de lijsten in haar project en erboven (verwijzingen gaan enkel naar boven, zoals in de app). */
  refs: Record<string, string>;
  /** Sleutel → id van de lijsten erboven en eronder (samenvatten van wat hiernaar verwijst). */
  calcs: Record<string, string>;
};

/**
 * De velden van lijsten uit een sjabloon, met echte verwijzingen: eerst naar een lijst uit hetzelfde sjabloon,
 * anders naar een lijst met dezelfde naam erboven (`byName`; een wijnkelder onder Huishouden verwijst naar zijn
 * Verkopers). Een verwijzing die nergens heen kan, valt weg, en een berekening die dan niet meer klopt ook.
 * `existing`: de lijsten die er al zijn (erboven). Geeft per id de velden.
 */
export function resolveTemplateLists(plans: TemplatePlan[], byName: Record<string, string>, existing: CalcList[] = []): Record<string, FieldDef[]> {
  const resolved: CalcList[] = plans.map(({ id, list, refs, calcs }) => {
    const target = (scope: Record<string, string>, ref?: string) => (ref && (scope[ref] || byName[ref.toLowerCase()])) || undefined;
    return {
      id,
      name: list.name,
      plural: list.plural,
      fields: list.fields.flatMap(({ ref, ...field }): FieldDef[] => {
        if (field.type === "item" || field.type === "items") {
          const to = target(refs, ref);
          return to ? [{ ...field, ref_type: to }] : [];
        }
        if (field.type === "calc" && field.calc?.kind === "rollup" && field.calc.from === "backlinks") {
          const to = target(calcs, field.calc.list);
          return to ? [{ ...field, calc: { ...field.calc, list: to } }] : [];
        }
        return [{ ...field }];
      }),
    };
  });
  // Berekeningen kunnen op die van een andere lijst steunen: een paar rondes, tot elke lijst de uitkomsten kent.
  let current = resolved;
  for (let round = 0; round < 3; round++) {
    current = resolved.map((l) => ({ ...l, fields: previewCalcs(l.fields, [...current.filter((x) => x.id !== l.id), ...existing], l.id).fields }));
  }
  // Wat dan nog niet klopt, valt weg (en wat erop verder bouwde ook).
  const out: Record<string, FieldDef[]> = {};
  for (const l of resolved) {
    let fields = l.fields;
    for (let i = 0; i <= fields.length; i++) {
      const { fields: checked, errors } = previewCalcs(fields, [...current.filter((x) => x.id !== l.id), ...existing], l.id);
      if (!Object.keys(errors).length) {
        fields = checked;
        break;
      }
      fields = fields.filter((f) => !errors[f.key]);
    }
    out[l.id] = fields;
  }
  return out;
}
