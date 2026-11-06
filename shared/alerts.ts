// Meldingen bij een nieuwe gebeurtenis (instelling per lijst, `lists.notify`): aan niemand, aan iedereen die de lijst
// ziet, of aan wie erin staat (betaalde, deelt, at mee, krijgt). Wie het logde, krijgt er geen; wie de lijst of een
// tag ervan stilzette (Jouw gegevens → Meldingen), ook niet. Kort na elkaar in dezelfde lijst: één melding (`tag`).

export type NotifyDef = { to: "all" } | { to: "people" };

export const NOTIFY_CHOICES = {
  none: "Geen melding",
  all: "Aan iedereen bij de lijst",
  people: "Aan wie erin staat",
} as const;

export function cleanNotify(raw: unknown): NotifyDef | null {
  if (!raw || typeof raw !== "object") return null;
  const to = (raw as Record<string, unknown>).to;
  return to === "all" ? { to: "all" } : to === "people" || to === "field" ? { to: "people" } : null;
}

/** Wie in een gebeurtenis staat: wie betaalde, wie deelt of at, en naar wie het ging. */
export function eventPeople(e: { paid_by: string | null; split: { person_id: string }[] | null; to_person: string | null }): string[] {
  return [...new Set([e.paid_by, e.to_person, ...(e.split ?? []).map((s) => s.person_id)].filter((x): x is string => Boolean(x)))];
}

/** Staat deze lijst (of een van haar tags) stil voor iemand? */
export const isMuted = (muted: string[], listId: string, tagIds: string[] = []) => muted.includes(listId) || tagIds.some((t) => muted.includes(t));

/** De tekst: "Jana logde een aankoop" / "Jana logde 3 keer in Voorraad", met de titel en het bedrag eronder. */
export function notifyMessage(o: { author: string; kind: string; list: string; title: string; count: number; detail?: string }): { title: string; body: string } {
  const body = `${o.title}${o.detail ? ` · ${o.detail}` : ""}`;
  if (o.count > 1) return { title: `${o.author} logde ${o.count} keer in ${o.list}`, body: `Laatst: ${body}` };
  return { title: `${o.author} logde ${o.kind.toLowerCase()} in ${o.list}`, body };
}
