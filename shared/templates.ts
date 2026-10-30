// Sjablonen: een goed vertrekpunt voor een nieuw project. Ze zetten lijsten met velden klaar; daarna kan je alles
// aanpassen. Er is niets speciaals aan: een project uit een sjabloon is een gewoon project.
//
// Een sjabloon kan ook een bestand zijn (zie shared/template-file.ts): een project dat iemand deelt, met dezelfde
// vorm als de ingebouwde sjablonen hieronder.

import { previewCalcs, type CalcDef, type CalcList } from "./calc.ts";
import type { FieldDef } from "./fields.ts";
import type { TotalDef } from "./totals.ts";

/** Iconen voor projecten en lijsten (namen uit src/components/Icon.tsx). */
export const ICONS = [
  "home",
  "project",
  "wine",
  "food",
  "recipe",
  "weight",
  "water",
  "calendar",
  "cart",
  "paw",
  "dumbbell",
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
export type TemplateField = Omit<FieldDef, "ref_type" | "result"> & {
  ref?: string;
  /** Een eenvoudigere berekening als deze niet kan (bv. Eten zonder Gerechten: de kcal enkel uit kcal per 100 g). */
  alt?: CalcDef;
};

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
    { key: "bedrag", label: "Bedrag", type: "money", required: true, column: true, hint: "het totaal dat je betaalde" },
    { key: "datum", label: "Datum", type: "date", required: true, column: true, today: true },
    { key: "betaald_door", label: "Betaald door", type: "person", column: true, filter: true, me: true },
    { key: "verkoper", label: "Verkoper", type: "item", ref: "verkoper", filter: true, hint: "de winkel of firma" },
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

/** Wie het at, woog of dronk: standaard jij, en elk ziet in de totalen zijn eigen dag. */
const WHO: TemplateField = { key: "wie", label: "Wie", type: "person", me: true, filter: true };
const TODAY: TemplateField = { key: "datum", label: "Datum", type: "date", required: true, today: true, column: true };
/** Een voedingswaarde per 100 g (uit de databank of geschat) en wat dat is voor wat je at. */
const per100 = (key: string, label: string, product: "protein" | "carbs" | "fat"): TemplateField[] => [
  { key: `${key}_100`, label: `${label} per 100 g`, type: "number", unit: "g", product },
  { key, label, type: "calc", unit: "g", calc: { kind: "formula", expr: `afronden([${key}_100] * [gram] / 100; 1)` } },
];

/**
 * Wat je eet: een foto van de verpakking vult de naam en de voedingswaarde per 100 g in; de app rekent uit wat dat is
 * voor wat je at en telt per dag, per persoon. Iets dat je zelf maakte, kies je als gerecht: de kcal komt dan uit zijn
 * ingrediënten.
 */
const FOOD: TypeTemplate = {
  key: "eten",
  name: "Eten",
  plural: "Eten",
  name_label: "Wat",
  icon: "food",
  fields: [
    TODAY,
    { key: "maaltijd", label: "Maaltijd", type: "select", options: ["Ontbijt", "Middag", "Avond", "Tussendoor"], filter: true },
    WHO,
    {
      key: "voorraad",
      label: "Uit voorraad",
      type: "item",
      ref: "product",
      copy: true,
      adjust: { field: "aantal", by: "stuks", sign: -1 },
      hint: "een product uit je voorraad: het neemt de voedingswaarde over en telt af wat je opat",
    },
    { key: "gerecht", label: "Gerecht", type: "item", ref: "gerecht", hint: "iets dat je zelf maakte: de kcal komt uit zijn ingrediënten" },
    {
      key: "kcal_100",
      label: "kcal per 100 g",
      type: "number",
      unit: "kcal",
      product: "kcal",
      hint: "per 100 g of 100 ml, in kcal (niet kJ): van de voedingstabel, anders geschat",
    },
    { key: "gram", label: "Hoeveel", type: "number", unit: "g", hint: "wat je at of dronk, in g of ml (niet de hele verpakking)" },
    { key: "inhoud", label: "Inhoud per stuk", type: "number", unit: "g", hint: "komt uit de voorraad: zo weet de app hoeveel stuks je opat" },
    {
      key: "stuks",
      label: "Van de voorraad",
      type: "calc",
      unit: "stuks",
      hint: "wat er van de voorraad afgaat: Hoeveel ÷ Inhoud per stuk (zonder inhoud: één stuk)",
      calc: { kind: "formula", expr: "afronden(of([gram] / [inhoud]; 1); 3)" },
    },
    { key: "gerecht_kcal_100", label: "kcal per 100 g van het gerecht", type: "calc", unit: "kcal", calc: { kind: "lookup", via: "gerecht", field: "kcal_100" } },
    {
      key: "kcal",
      label: "Kcal",
      type: "calc",
      unit: "kcal",
      column: true,
      calc: { kind: "formula", expr: "afronden(of([kcal_100]; [gerecht_kcal_100]) * [gram] / 100)" },
      alt: { kind: "formula", expr: "afronden([kcal_100] * [gram] / 100)" },
    },
    ...per100("eiwit", "Eiwit", "protein"),
    ...per100("koolhydraten", "Koolhydraten", "carbs"),
    ...per100("vet", "Vet", "fat"),
    NOTE,
  ],
  totals: [
    { id: "dag", label: "Kcal per dag", agg: "sum", field: "kcal", period: "day", date: "datum", mine: "wie" },
    { id: "eiwit", label: "Eiwit per dag", agg: "sum", field: "eiwit", period: "day", date: "datum", mine: "wie", size: "small" },
    { id: "koolhydraten", label: "Koolhydraten per dag", agg: "sum", field: "koolhydraten", period: "day", date: "datum", mine: "wie", size: "small" },
    { id: "vet", label: "Vet per dag", agg: "sum", field: "vet", period: "day", date: "datum", mine: "wie", size: "small" },
  ],
};

/** Iets dat je zelf maakt: de kcal per 100 g volgt uit zijn ingrediënten (en wat het weegt als het klaar is). */
const DISH: TypeTemplate = {
  key: "gerecht",
  name: "Gerecht",
  plural: "Gerechten",
  icon: "recipe",
  fields: [
    { key: "porties", label: "Porties", type: "number", unit: "porties" },
    { key: "klaar", label: "Weegt klaar", type: "number", unit: "g", hint: "na het koken (leeg = wat de ingrediënten samen wegen)" },
    { key: "totaal_kcal", label: "Kcal in totaal", type: "calc", unit: "kcal", calc: { kind: "rollup", from: "backlinks", list: "ingredient", via: "gerecht", agg: "sum", field: "kcal" } },
    { key: "totaal_gram", label: "Ingrediënten samen", type: "calc", unit: "g", calc: { kind: "rollup", from: "backlinks", list: "ingredient", via: "gerecht", agg: "sum", field: "gram" } },
    { key: "kcal_100", label: "kcal per 100 g", type: "calc", unit: "kcal", column: true, calc: { kind: "formula", expr: "afronden([totaal_kcal] / of([klaar]; [totaal_gram]) * 100)" } },
    { key: "kcal_portie", label: "kcal per portie", type: "calc", unit: "kcal", column: true, calc: { kind: "formula", expr: "afronden([totaal_kcal] / [porties])" } },
    { key: "bereiding", label: "Bereiding", type: "longtext" },
  ],
};

const INGREDIENT: TypeTemplate = {
  key: "ingredient",
  name: "Ingrediënt",
  plural: "Ingrediënten",
  icon: "food",
  fields: [
    { key: "gerecht", label: "Gerecht", type: "item", ref: "gerecht", required: true, column: true, filter: true },
    { key: "kcal_100", label: "kcal per 100 g", type: "number", unit: "kcal", product: "kcal", hint: "van de verpakking, anders geschat" },
    { key: "gram", label: "Hoeveel", type: "number", unit: "g" },
    { key: "kcal", label: "Kcal", type: "calc", unit: "kcal", column: true, calc: { kind: "formula", expr: "afronden([kcal_100] * [gram] / 100)" } },
  ],
};

/** Je gewicht: per week het gemiddelde, als lijn, ieder het zijne. */
const WEIGHT: TypeTemplate = {
  key: "weging",
  name: "Weging",
  plural: "Gewicht",
  icon: "weight",
  fields: [TODAY, WHO, { key: "kg", label: "Gewicht", type: "number", unit: "kg", required: true, column: true }, NOTE],
  totals: [{ id: "week", label: "Gewicht per week", agg: "avg", field: "kg", period: "week", date: "datum", mine: "wie", chart: "line" }],
};

/** Wat je drinkt: per dag opgeteld, met een doel. */
const WATER: TypeTemplate = {
  key: "water",
  name: "Water",
  plural: "Water",
  icon: "water",
  fields: [TODAY, WHO, { key: "ml", label: "Hoeveel", type: "number", unit: "ml", required: true, column: true }],
  totals: [{ id: "dag", label: "Water per dag", agg: "sum", field: "ml", period: "day", date: "datum", mine: "wie", goal: 2000, goal_kind: "min" }],
};

/** Een recept om te koken (los van Voeding: daar rekent een Gerecht de kcal uit zijn ingrediënten). */
const RECIPE: TypeTemplate = {
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
};

const TRIP: TypeTemplate = {
  key: "reis",
  name: "Reis",
  plural: "Reizen",
  name_label: "Bestemming",
  icon: "pin",
  fields: [
    { key: "periode", label: "Periode", type: "date_range", column: true, filter: true, agenda: true },
    { key: "wie", label: "Wie gaat mee", type: "people", filter: true },
    { key: "vertrek", label: "Vertrek", type: "time" },
    { key: "budget", label: "Budget", type: "money" },
    { key: "logies", label: "Logies", type: "address" },
    { key: "paklijst", label: "Paklijst", type: "checklist" },
    NOTE,
  ],
};

/** Wat je op een reis doet: per dag in de agenda. */
const ACTIVITY: TypeTemplate = {
  key: "activiteit",
  name: "Activiteit",
  plural: "Programma",
  icon: "star",
  fields: [
    { key: "reis", label: "Reis", type: "item", ref: "reis", required: true, column: true, filter: true },
    { key: "datum", label: "Datum", type: "date", column: true, agenda: true },
    { key: "tijd", label: "Om", type: "time" },
    { key: "plaats", label: "Waar", type: "address" },
    { key: "kost", label: "Kost", type: "money" },
    { key: "geboekt", label: "Geboekt", type: "bool", filter: true },
    { key: "boeking", label: "Boeking of ticket", type: "url" },
    NOTE,
  ],
};

/** Losse notities: een titel, tekst en tags; vastgezet bovenaan te filteren. */
const NOTES: TypeTemplate = {
  key: "notitie",
  name: "Notitie",
  plural: "Notities",
  name_label: "Titel",
  icon: "note",
  fields: [
    { key: "tekst", label: "Tekst", type: "longtext" },
    { key: "vast", label: "Vastgezet", type: "bool", filter: true },
    { key: "datum", label: "Datum", type: "date", today: true, column: true },
  ],
};

const PET: TypeTemplate = {
  key: "huisdier",
  name: "Huisdier",
  plural: "Huisdieren",
  icon: "paw",
  fields: [
    { key: "soort", label: "Soort", type: "select", options: ["Hond", "Kat", "Konijn", "Cavia", "Vogel", "Vis", "Paard", "Andere"], column: true, filter: true },
    { key: "ras", label: "Ras", type: "text" },
    { key: "geboren", label: "Geboren", type: "date", remind: 1, yearly: true, agenda: true },
    { key: "leeftijd", label: "Leeftijd", type: "calc", column: true, calc: { kind: "since", field: "geboren", unit: "year" } },
    { key: "chip", label: "Chipnummer", type: "text" },
    { key: "dierenarts", label: "Dierenarts", type: "phone", hint: "het nummer van de dierenarts" },
    { key: "zorg", label: "Voeding en zorg", type: "longtext" },
    NOTE,
  ],
};

/** Wat een huisdier nodig heeft (inenting, ontworming, …): de volgende keer in de agenda, met een herinnering. */
const PET_CARE: TypeTemplate = {
  key: "verzorging",
  name: "Verzorging",
  plural: "Verzorging",
  icon: "clock",
  fields: [
    { key: "huisdier", label: "Huisdier", type: "item", ref: "huisdier", required: true, column: true, filter: true },
    {
      key: "wat",
      label: "Wat",
      type: "select",
      options: ["Inenting", "Ontworming", "Vlooien en teken", "Dierenarts", "Trimmen", "Nagels", "Andere"],
      filter: true,
    },
    { key: "datum", label: "Gedaan op", type: "date", required: true, today: true },
    { key: "elke", label: "Om de", type: "interval", hint: "bv. elk jaar, elke 3 maanden" },
    { key: "volgende", label: "Volgende keer", type: "calc", column: true, remind: 7, agenda: true, calc: { kind: "date_add", field: "datum", add: { field: "elke" } } },
    { key: "kost", label: "Kost", type: "money" },
    NOTE,
  ],
  totals: [{ id: "jaar", label: "Kosten per jaar", agg: "sum", field: "kost", period: "year", date: "datum" }],
};

/** Sport: per week hoeveel tijd, afstand en kcal, ieder het zijne. */
const WORKOUT: TypeTemplate = {
  key: "training",
  name: "Training",
  plural: "Trainingen",
  icon: "dumbbell",
  fields: [
    { key: "datum", label: "Datum", type: "date", required: true, today: true, column: true },
    { key: "wie", label: "Wie", type: "person", me: true, filter: true },
    {
      key: "soort",
      label: "Soort",
      type: "select",
      options: ["Lopen", "Fietsen", "Zwemmen", "Wandelen", "Fitness", "Yoga", "Padel", "Voetbal", "Andere"],
      column: true,
      filter: true,
    },
    { key: "duur", label: "Duur", type: "duration", column: true },
    { key: "afstand", label: "Afstand", type: "number", unit: "km" },
    { key: "kcal", label: "Verbruikt", type: "number", unit: "kcal" },
    { key: "gevoel", label: "Gevoel", type: "score" },
    NOTE,
  ],
  totals: [
    { id: "duur", label: "Sporttijd per week", agg: "sum", field: "duur", period: "week", date: "datum", mine: "wie" },
    { id: "afstand", label: "Afstand per week", agg: "sum", field: "afstand", period: "week", date: "datum", mine: "wie", size: "small" },
    { id: "kcal", label: "Verbruikt per week", agg: "sum", field: "kcal", period: "week", date: "datum", mine: "wie", size: "small" },
  ],
};

/**
 * De winkellijst, verbonden met de voorraad: kies een product (het neemt zijn gegevens over), en vink af wat je
 * kocht: dan telt het bij het aantal in de voorraad (en weer af als je het afvinken ongedaan maakt).
 */
const SHOPPING: TypeTemplate = {
  key: "boodschap",
  name: "Boodschap",
  plural: "Winkellijst",
  name_label: "Wat",
  icon: "cart",
  fields: [
    {
      key: "product",
      label: "Product",
      type: "item",
      ref: "product",
      copy: true,
      adjust: { field: "aantal", by: "binnen", sign: 1 },
      hint: "uit je voorraad: afgevinkt telt het erbij",
    },
    { key: "hoeveel", label: "Hoeveel", type: "number", column: true },
    { key: "gekocht", label: "Gekocht", type: "bool", column: true, filter: true },
    {
      key: "binnen",
      label: "Naar de voorraad",
      type: "calc",
      hint: "wat er bij de voorraad komt: Hoeveel, als het gekocht is",
      calc: { kind: "formula", expr: "als([gekocht]; of([hoeveel]; 1); 0)" },
    },
    { key: "winkel", label: "Winkel", type: "item", ref: "verkoper", filter: true },
    NOTE,
  ],
};

/** Wat je gaat eten: per dag in de agenda; een gerecht vult de naam in. */
const MEAL_PLAN: TypeTemplate = {
  key: "maaltijd",
  name: "Maaltijd",
  plural: "Maaltijdplan",
  name_label: "Wat",
  icon: "calendar",
  fields: [
    { key: "datum", label: "Datum", type: "date", required: true, column: true, agenda: true },
    { key: "moment", label: "Maaltijd", type: "select", options: ["Ontbijt", "Middag", "Avond", "Tussendoor"], column: true, filter: true },
    { key: "gerecht", label: "Gerecht", type: "item", ref: "gerecht", copy: true },
    { key: "wie", label: "Voor wie", type: "people" },
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
    description: "Wat je hebt, je voorraad en winkellijst, klantenkaarten, verkopers, plaatsen en uitgaven",
    icon: "home",
    types: [
      {
        key: "item",
        name: "Item",
        plural: "Bezit",
        icon: "armchair",
        fields: [
          { key: "merk", label: "Merk", type: "text", column: true },
          { key: "plaats", label: "Plaats", type: "item", ref: "plaats", column: true, filter: true },
          { key: "gekocht_bij", label: "Gekocht bij", type: "item", ref: "verkoper" },
          { key: "gekocht_op", label: "Gekocht op", type: "date" },
          { key: "prijs", label: "Prijs", type: "money" },
          { key: "garantie_tot", label: "Garantie tot", type: "date", remind: 30 },
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
          { key: "aantal", label: "Aantal", type: "number", column: true, counter: true },
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
          { key: "inhoud", label: "Inhoud per stuk", type: "number", unit: "g", hint: "in g of ml: zo rekent Eten uit hoeveel stuks je opat" },
          { key: "kcal_100", label: "kcal per 100 g", type: "number", unit: "kcal", product: "kcal" },
          { key: "eiwit_100", label: "Eiwit per 100 g", type: "number", unit: "g", product: "protein" },
          { key: "koolhydraten_100", label: "Koolhydraten per 100 g", type: "number", unit: "g", product: "carbs" },
          { key: "vet_100", label: "Vet per 100 g", type: "number", unit: "g", product: "fat" },
          NOTE,
        ],
      },
      SHOPPING,
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
    description: "Wat je eet (kcal en macro's per dag, ook uit je voorraad), een maaltijdplan, gerechten, je gewicht en water",
    icon: "food",
    types: [FOOD, MEAL_PLAN, DISH, INGREDIENT, WEIGHT, WATER],
  },
  recipes: {
    label: "Recepten",
    description: "Je kookboek: ingrediënten, bereiding, hoe lang en hoe lekker",
    icon: "recipe",
    types: [RECIPE],
  },
  notes: {
    label: "Notities",
    description: "Losse notities, ideeën en lijstjes, met tags",
    icon: "note",
    types: [NOTES],
  },
  pets: {
    label: "Huisdieren",
    description: "Je dieren, hun verjaardag en verzorging, met een herinnering voor de volgende inenting",
    icon: "paw",
    types: [PET, PET_CARE],
  },
  trips: {
    label: "Reizen",
    description: "Reizen met hun programma per dag, paklijst en budget, in de agenda",
    icon: "pin",
    types: [TRIP, ACTIVITY],
  },
  sport: {
    label: "Sport",
    description: "Je trainingen: tijd, afstand en kcal per week, ieder het zijne",
    icon: "dumbbell",
    types: [WORKOUT],
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
      { key: "volgende", label: "Volgende keer", type: "calc", column: true, remind: 7, agenda: true, calc: { kind: "date_add", field: "laatst", add: { field: "elke" } } },
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
      { key: "volgende", label: "Volgende betaling", type: "calc", column: true, agenda: true, calc: { kind: "date_add", field: "betaald", add: { field: "elke" } } },
      { key: "opzeggen", label: "Opzeggen voor", type: "date", remind: 14, agenda: true },
      { key: "website", label: "Website", type: "url" },
      { key: "klantnummer", label: "Klantnummer", type: "text", hint: "Nooit een wachtwoord" },
      { key: "wie", label: "Op naam van", type: "person", filter: true },
      NOTE,
    ],
  },
  RECIPE,
  TRIP,
  {
    key: "contact",
    name: "Contact",
    plural: "Contacten",
    icon: "users",
    fields: [
      { key: "telefoon", label: "Telefoon", type: "phone", column: true },
      { key: "email", label: "E-mail", type: "email" },
      { key: "adres", label: "Adres", type: "address" },
      { key: "verjaardag", label: "Verjaardag", type: "date", remind: 1, yearly: true, agenda: true },
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
      { key: "tegen", label: "Tegen", type: "date", column: true, remind: 1, agenda: true },
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
  const alts: Record<string, Record<string, CalcDef>> = {};
  const resolved: CalcList[] = plans.map(({ id, list, refs, calcs }) => {
    alts[id] = Object.fromEntries(list.fields.flatMap((f) => (f.alt ? [[f.key, f.alt]] : [])));
    const target = (scope: Record<string, string>, ref?: string) => (ref && (scope[ref] || byName[ref.toLowerCase()])) || undefined;
    return {
      id,
      name: list.name,
      plural: list.plural,
      fields: list.fields.flatMap(({ ref, alt: _alt, ...field }): FieldDef[] => {
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
  // Wat dan nog niet klopt, krijgt zijn eenvoudigere berekening of valt weg (en wat erop verder bouwde ook).
  const out: Record<string, FieldDef[]> = {};
  for (const l of resolved) {
    let fields = l.fields;
    const alt = alts[l.id];
    for (let i = 0; i <= 2 * l.fields.length; i++) {
      const { fields: checked, errors } = previewCalcs(fields, [...current.filter((x) => x.id !== l.id), ...existing], l.id);
      if (!Object.keys(errors).length) {
        fields = checked;
        break;
      }
      const swap = (f: FieldDef) => errors[f.key] && alt[f.key] && f.calc !== alt[f.key];
      fields = fields.some(swap) ? fields.map((f) => (swap(f) ? { ...f, calc: alt[f.key] } : f)) : fields.filter((f) => !errors[f.key]);
    }
    out[l.id] = fields;
  }
  return out;
}
