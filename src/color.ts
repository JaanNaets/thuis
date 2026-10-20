/** Witte of donkere tekst, afhankelijk van hoe licht de achtergrondkleur is. */
export function textColorFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0a0a0a" : "#ffffff";
}

// Snelle keuzes in het formulier; via de kleurkiezer kan ook elke andere kleur (bv. de huiskleur van de winkel).
export const CARD_COLORS = [
  "#171717", // zwart
  "#e5e5e5", // grijs
  "#f97316", // oranje
  "#facc15", // geel
  "#16a34a", // groen
  "#0284c7", // blauw
  "#6d28d9", // paars
  "#e11d48", // rood
];

export const DEFAULT_CARD_COLOR = CARD_COLORS[1];
