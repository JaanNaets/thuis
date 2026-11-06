// Sjablonen voor een nieuwe lijst: een goed vertrekpunt met velden, een voorraad als ze telt, en eigen soorten voor
// haar logboek (Gegeten, Tankbeurt, Proeverij). Daarna kan je alles aanpassen: een lijst uit een sjabloon is een
// gewone lijst. Elke lijst met dingen heeft een notitieveld (STIJLBOEK.md → Formulier).

import type { FieldDef } from "./fields.ts";
import type { IconKey } from "./icons.ts";
import type { Base } from "./model.ts";
import type { StockDef } from "./stock.ts";

export type KindTemplate = { base: Base; name: string; icon?: IconKey; fields?: FieldDef[]; goal?: number };

export type ListTemplate = {
  key: string;
  name: string;
  /** Hoe één ding heet; null = enkel een logboek. */
  one: string | null;
  icon: IconKey;
  fields: FieldDef[];
  stock?: StockDef;
  kinds?: KindTemplate[];
};

const note: FieldDef = { key: "notitie", label: "Notitie", type: "longtext" };
const kcal: FieldDef = { key: "kcal", label: "Kcal", type: "number", product: "kcal", unit: "kcal" };

export const TEMPLATES: ListTemplate[] = [
  {
    key: "leeg",
    name: "Lijst",
    one: "Ding",
    icon: "folder",
    fields: [note],
  },
  {
    key: "logboek",
    name: "Logboek",
    one: null,
    icon: "note",
    fields: [],
  },
  {
    key: "voorraad",
    name: "Voorraad",
    one: "Product",
    icon: "food",
    fields: [
      { key: "eenheid", label: "Eenheid", type: "select", options: ["stuk", "g", "kg", "ml", "l", "pot", "zak", "fles", "doos"], column: true },
      { key: "per_stuk", label: "Per stuk", type: "number", unit: "g" },
      { key: "verpakking", label: "In een verpakking", type: "number" },
      { key: "verpakking_naam", label: "Verpakking heet", type: "text" },
      { key: "minimum", label: "Bijna op onder", type: "number" },
      { key: "plaats", label: "Plaats", type: "select", options: ["Koelkast", "Diepvries", "Kast", "Kelder"], filter: true },
      { key: "categorie", label: "Categorie", type: "select", options: ["Groenten en fruit", "Zuivel", "Vlees en vis", "Brood", "Droge voeding", "Drinken", "Snacks", "Huishouden"], filter: true },
      { key: "barcode", label: "Barcode", type: "code", format: "ean_13" },
      { key: "kasticket", label: "Op het kasticket", type: "text", aliases: true },
      { key: "kcal", label: "Kcal per 100 g", type: "number", product: "kcal" },
      { key: "eiwit", label: "Eiwitten per 100 g", type: "number", product: "protein" },
      { key: "koolhydraten", label: "Koolhydraten per 100 g", type: "number", product: "carbs" },
      { key: "vet", label: "Vetten per 100 g", type: "number", product: "fat" },
      { key: "portie", label: "Portie", type: "number", unit: "g", product: "serving" },
      note,
    ],
    stock: { unit: "eenheid", piece: "per_stuk", pack: "verpakking", pack_name: "verpakking_naam", min: "minimum", default_unit: "stuk" },
    kinds: [
      { base: "gebruik", name: "Gegeten", icon: "food", fields: [kcal] },
      { base: "gebruik", name: "Weggegooid", icon: "package" },
    ],
  },
  {
    key: "wijnen",
    name: "Wijnen",
    one: "Wijn",
    icon: "wine",
    fields: [
      { key: "kleur", label: "Kleur", type: "select", options: ["Rood", "Wit", "Rosé", "Mousserend", "Dessert"], column: true, filter: true },
      { key: "jaargang", label: "Jaargang", type: "year", column: true },
      { key: "wijnhuis", label: "Wijnhuis", type: "text" },
      { key: "land", label: "Land", type: "text", filter: true },
      { key: "streek", label: "Streek", type: "text" },
      { key: "druiven", label: "Druiven", type: "multi" },
      { key: "drinkklaar", label: "Drinkklaar", type: "year_range", filter: true },
      { key: "score", label: "Score", type: "score" },
      { key: "plaats", label: "Plaats", type: "text", filter: true },
      { key: "kasticket", label: "Op het kasticket", type: "text", aliases: true },
      note,
    ],
    stock: { default_unit: "fles" },
    kinds: [{ base: "gebruik", name: "Proeverij", icon: "wine", fields: [{ key: "score", label: "Score", type: "score" }, note] }],
  },
  {
    key: "wagens",
    name: "Wagens",
    one: "Wagen",
    icon: "car",
    fields: [
      { key: "merk", label: "Merk", type: "text", column: true },
      { key: "model", label: "Model", type: "text" },
      { key: "nummerplaat", label: "Nummerplaat", type: "text", column: true },
      { key: "bouwjaar", label: "Bouwjaar", type: "year" },
      { key: "brandstof", label: "Brandstof", type: "select", options: ["Benzine", "Diesel", "Elektrisch", "Hybride", "LPG"] },
      { key: "keuring", label: "Volgende keuring", type: "date", remind: 14, agenda: true },
      { key: "verzekerd_tot", label: "Verzekerd tot", type: "date", remind: 30 },
      note,
    ],
    kinds: [
      { base: "aankoop", name: "Tankbeurt", icon: "flame", fields: [{ key: "liter", label: "Liter", type: "number", unit: "l" }, { key: "km", label: "Km-stand", type: "number", unit: "km" }] },
      { base: "dienst", name: "Onderhoud", icon: "wrench", fields: [{ key: "km", label: "Km-stand", type: "number", unit: "km" }, note] },
      { base: "dienst", name: "Carwash", icon: "water" },
      { base: "meting", name: "Km-stand", icon: "car", fields: [{ key: "waarde", label: "Km-stand", type: "number", unit: "km" }] },
    ],
  },
  {
    key: "fietsen",
    name: "Fietsen",
    one: "Fiets",
    icon: "bike",
    fields: [
      { key: "merk", label: "Merk", type: "text", column: true },
      { key: "model", label: "Model", type: "text" },
      { key: "framenummer", label: "Framenummer", type: "text" },
      note,
    ],
    kinds: [{ base: "dienst", name: "Onderhoud", icon: "wrench", fields: [note] }],
  },
  {
    key: "bezit",
    name: "Bezit",
    one: "Ding",
    icon: "armchair",
    fields: [
      { key: "merk", label: "Merk", type: "text", column: true },
      { key: "model", label: "Model", type: "text" },
      { key: "plaats", label: "Plaats", type: "text", filter: true },
      { key: "garantie_tot", label: "Garantie tot", type: "date", remind: 30, column: true },
      { key: "serienummer", label: "Serienummer", type: "text" },
      note,
    ],
    kinds: [{ base: "dienst", name: "Herstelling", icon: "wrench", fields: [note] }],
  },
  {
    key: "afspraken",
    name: "Afspraken",
    one: "Afspraak",
    icon: "repeat",
    fields: [
      { key: "bedrag", label: "Bedrag", type: "money", column: true },
      { key: "om_de", label: "Om de", type: "interval" },
      { key: "opzeggen", label: "Opzeggen voor", type: "date", remind: 14, agenda: true },
      { key: "klantnummer", label: "Klantnummer", type: "text" },
      { key: "website", label: "Website", type: "url" },
      note,
    ],
  },
  {
    key: "winkels",
    name: "Winkels en diensten",
    one: "Winkel",
    icon: "store",
    fields: [
      { key: "adres", label: "Adres", type: "address" },
      { key: "telefoon", label: "Telefoon", type: "phone" },
      { key: "website", label: "Website", type: "url" },
      { key: "kasticket", label: "Op het kasticket", type: "text", aliases: true },
      note,
    ],
  },
  {
    key: "pellets",
    name: "Pellets",
    one: "Pellets",
    icon: "flame",
    fields: [
      { key: "eenheid", label: "Eenheid", type: "select", options: ["kg", "zak"] },
      { key: "verpakking", label: "In een zak", type: "number", unit: "kg" },
      { key: "minimum", label: "Bijna op onder", type: "number", unit: "kg" },
      { key: "merk", label: "Merk", type: "text" },
      note,
    ],
    stock: { unit: "eenheid", pack: "verpakking", min: "minimum", default_unit: "kg" },
    kinds: [
      { base: "gebruik", name: "Bijvulling", icon: "flame" },
      { base: "dienst", name: "Onderhoud kachel", icon: "wrench" },
    ],
  },
  {
    key: "persoonlijk",
    name: "Persoonlijk",
    one: null,
    icon: "user",
    fields: [],
    kinds: [
      { base: "gebruik", name: "Gegeten", icon: "food", fields: [kcal] },
      { base: "meting", name: "Gewicht", icon: "weight", fields: [{ key: "waarde", label: "Gewicht", type: "number", unit: "kg" }] },
      { base: "meting", name: "Water", icon: "water", fields: [{ key: "waarde", label: "Water", type: "number", unit: "ml" }] },
      { base: "activiteit", name: "Sport", icon: "dumbbell", fields: [{ key: "km", label: "Afstand", type: "number", unit: "km" }] },
      { base: "activiteit", name: "Slaap", icon: "moon" },
      { base: "activiteit", name: "Werk", icon: "clock" },
      { base: "activiteit", name: "Vasten", icon: "clock", goal: 16 * 60 },
      { base: "dienst", name: "Dokter", icon: "user" },
    ],
  },
  {
    key: "taken",
    name: "Taken",
    one: null,
    icon: "calendar",
    fields: [],
    kinds: [{ base: "activiteit", name: "Taak", icon: "calendar", fields: [note] }],
  },
  {
    key: "recepten",
    name: "Recepten",
    one: "Recept",
    icon: "recipe",
    fields: [
      { key: "porties", label: "Porties", type: "number" },
      { key: "ingredienten", label: "Ingrediënten", type: "amounts", per: "porties" },
      { key: "bereiding", label: "Bereiding", type: "longtext" },
      { key: "bron", label: "Bron", type: "url" },
    ],
  },
];

export const templateByKey = (key: string | null | undefined) => TEMPLATES.find((t) => t.key === key);
