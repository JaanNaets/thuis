// Volgorde: projecten, lijsten, velden.

/** Een element verplaatsen in een lijst, van plaats `from` naar plaats `to` (de rest schuift op). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/** Een volgorde van buiten: unieke id's, hooguit `max`. Null als het geen geldige lijst is. */
export function cleanOrder(raw: unknown, max = 200): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > max) return null;
  if (!raw.every((id) => typeof id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(id))) return null;
  return new Set(raw).size === raw.length ? (raw as string[]) : null;
}
