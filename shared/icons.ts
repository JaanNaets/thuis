// Iconen voor lijsten, tags en soorten (namen uit src/components/Icon.tsx).

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
  "flame",
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
  "car",
  "moon",
  "wrench",
  "user",
  "bank",
  "piggy",
] as const;
export type IconKey = (typeof ICONS)[number];

export function isIconKey(value: unknown): value is IconKey {
  return typeof value === "string" && (ICONS as readonly string[]).includes(value);
}
