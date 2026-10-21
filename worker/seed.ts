// Startindeling van een nieuw huishouden: dezelfde categorieën en plaatsen als het eerste huishouden kreeg.
// De sleutel (key) blijft per huishouden gelijk, zodat productgegevens (Open Food Facts) een categorie vinden.

import type { Tone } from "../shared/types";

type SeedCategory = { key: string; domain: "expense" | "item"; parent?: string; name: string; color?: Tone };

const CATEGORIES: SeedCategory[] = [
  { key: "exp-boodschappen", domain: "expense", name: "Boodschappen", color: "sage" },
  { key: "exp-wonen", domain: "expense", name: "Wonen", color: "peach" },
  { key: "exp-energie", domain: "expense", name: "Energie & water", color: "butter" },
  { key: "exp-elektronica", domain: "expense", name: "Elektronica", color: "sky" },
  { key: "exp-huishoudtoestellen", domain: "expense", name: "Huishoudtoestellen", color: "mint" },
  { key: "exp-meubels", domain: "expense", name: "Meubels", color: "peach" },
  { key: "exp-kleding", domain: "expense", name: "Kleding", color: "rose" },
  { key: "exp-gereedschap", domain: "expense", name: "Gereedschap", color: "butter" },
  { key: "exp-tuin", domain: "expense", name: "Tuin", color: "sage" },
  { key: "exp-auto-fiets", domain: "expense", name: "Auto & fiets", color: "sky" },
  { key: "exp-restaurant", domain: "expense", name: "Restaurant & uit", color: "rose" },
  { key: "exp-gezondheid", domain: "expense", name: "Gezondheid", color: "mint" },
  { key: "exp-abonnementen", domain: "expense", name: "Abonnementen", color: "lilac" },
  { key: "exp-reizen", domain: "expense", name: "Reizen", color: "sky" },
  { key: "exp-cadeaus", domain: "expense", name: "Cadeaus", color: "lilac" },
  { key: "exp-andere", domain: "expense", name: "Andere", color: "butter" },
  { key: "item-voeding", domain: "item", name: "Voeding", color: "sage" },
  { key: "item-groenten-fruit", domain: "item", parent: "item-voeding", name: "Groenten & fruit" },
  { key: "item-zuivel", domain: "item", parent: "item-voeding", name: "Zuivel & eieren" },
  { key: "item-vlees-vis", domain: "item", parent: "item-voeding", name: "Vlees & vis" },
  { key: "item-brood-ontbijt", domain: "item", parent: "item-voeding", name: "Brood & ontbijt" },
  { key: "item-pasta-conserven", domain: "item", parent: "item-voeding", name: "Pasta, rijst & conserven" },
  { key: "item-diepvries", domain: "item", parent: "item-voeding", name: "Diepvries" },
  { key: "item-snacks", domain: "item", parent: "item-voeding", name: "Snacks & snoep" },
  { key: "item-kruiden", domain: "item", parent: "item-voeding", name: "Kruiden & sauzen" },
  { key: "item-dranken", domain: "item", name: "Dranken", color: "sky" },
  { key: "item-huishouden", domain: "item", name: "Huishouden", color: "mint" },
  { key: "item-schoonmaak", domain: "item", parent: "item-huishouden", name: "Schoonmaak" },
  { key: "item-was", domain: "item", parent: "item-huishouden", name: "Was" },
  { key: "item-papier", domain: "item", parent: "item-huishouden", name: "Papier & folie" },
  { key: "item-verzorging", domain: "item", name: "Verzorging", color: "rose" },
  { key: "item-medicijnen", domain: "item", name: "Medicijnen", color: "lilac" },
  { key: "item-huisdier", domain: "item", name: "Huisdier", color: "butter" },
  { key: "item-toestellen", domain: "item", name: "Toestellen", color: "sky" },
  { key: "item-gereedschap", domain: "item", name: "Gereedschap", color: "peach" },
  { key: "item-andere", domain: "item", name: "Andere", color: "butter" },
];

const LOCATIONS: { key: string; parent?: string; name: string }[] = [
  { key: "keuken", name: "Keuken" },
  { key: "koelkast", parent: "keuken", name: "Koelkast" },
  { key: "diepvries", parent: "keuken", name: "Diepvries" },
  { key: "voorraadkast", parent: "keuken", name: "Voorraadkast" },
  { key: "badkamer", name: "Badkamer" },
  { key: "berging", name: "Berging" },
  { key: "garage", name: "Garage" },
];

/** Statements die de startindeling in een nieuw huishouden zetten (voor in één batch). */
export function seedStatements(db: D1Database, household: string): D1PreparedStatement[] {
  const ids = new Map<string, string>();
  const id = (key: string) => {
    let value = ids.get(key);
    if (!value) ids.set(key, (value = crypto.randomUUID()));
    return value;
  };
  const siblings = new Map<string, number>();
  const order = (group: string) => {
    const next = (siblings.get(group) ?? 0) + 10;
    siblings.set(group, next);
    return next;
  };
  return [
    ...CATEGORIES.map((c) =>
      db
        .prepare(
          `INSERT INTO categories (id, household_id, domain, parent_id, key, name, color, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id(c.key),
          household,
          c.domain,
          c.parent ? id(c.parent) : null,
          c.key,
          c.name,
          c.color ?? null,
          c.key.endsWith("-andere") ? 999 : order(`${c.domain}:${c.parent ?? ""}`),
        ),
    ),
    ...LOCATIONS.map((l) =>
      db
        .prepare("INSERT INTO locations (id, household_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?, ?)")
        .bind(id(`loc:${l.key}`), household, l.parent ? id(`loc:${l.parent}`) : null, l.name, order(`loc:${l.parent ?? ""}`)),
    ),
  ];
}
