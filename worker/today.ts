/** De datum van vandaag in België (YYYY-MM-DD): daar wonen de mensen van deze app, en daar is het 's morgens. */
export const brusselsToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Het moment in België tot op de minuut ("2026-11-05T18:30"), voor herinneringen met een uur. */
export function brusselsMoment(at = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
