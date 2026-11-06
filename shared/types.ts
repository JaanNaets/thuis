// Gedeelde types tussen de Worker (API) en de React-app die niet bij één onderdeel horen: kleuren en personen. De
// rest staat bij zijn onderdeel (shared/model.ts: lijsten, dingen en gebeurtenissen).

/** Een zachte kleur voor een lijst, tag of persoon. */
export const TONES = ["peach", "butter", "sage", "mint", "sky", "lilac", "rose"] as const;
export type Tone = (typeof TONES)[number];

export function isTone(value: unknown): value is Tone {
  return typeof value === "string" && (TONES as readonly string[]).includes(value);
}

export type Person = {
  id: string;
  name: string;
  /** Leeg = meldt (nog) niet aan. */
  email: string | null;
  color: Tone | null;
  /** Rekeningnummer, om terugbetaald te worden (enkel voor jezelf en in Wie moet wie). */
  iban?: string | null;
};

/** Lezen met AI: aan of uit voor jou, en hoe vaak vandaag van je daglimiet. */
export type AiState = { on: boolean; used: number; limit: number };
