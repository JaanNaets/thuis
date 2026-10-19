/** Witte of donkere tekst, afhankelijk van hoe licht de achtergrondkleur is. */
export function textColorFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#2d2421" : "#fffdf9";
}

// Pastelkeuzes in het formulier; via de kleurkiezer kan ook elke andere kleur (bv. de huiskleur van de winkel).
export const CARD_COLORS = [
  "#f6c9b4", // perzik
  "#f4e1a1", // boter
  "#cfe3c6", // salie
  "#c4e4dc", // munt
  "#c9dcf0", // hemel
  "#ddd2f1", // lila
  "#f2cad6", // roos
  "#e8ddcf", // haver
];

export const DEFAULT_CARD_COLOR = CARD_COLORS[7];
