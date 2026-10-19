// Kleine helpers om binnenkomende JSON te controleren voor we iets in de database schrijven.

export class ValidationError extends Error {}

type Obj = Record<string, unknown>;

export function asObject(body: unknown): Obj {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("Ongeldige invoer");
  }
  return body as Obj;
}

export function requiredString(obj: Obj, key: string, max: number): string {
  const value = optionalString(obj, key, max);
  if (!value) throw new ValidationError(`'${key}' is verplicht`);
  return value;
}

/** Lege strings worden NULL. */
export function optionalString(obj: Obj, key: string, max: number): string | null {
  const value = obj[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ValidationError(`'${key}' moet tekst zijn`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ValidationError(`'${key}' is te lang (max ${max})`);
  return trimmed === "" ? null : trimmed;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function optionalDate(obj: Obj, key: string): string | null {
  const value = optionalString(obj, key, 10);
  if (value === null) return null;
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`'${key}' moet een datum zijn (JJJJ-MM-DD)`);
  }
  return value;
}

export function requiredDate(obj: Obj, key: string): string {
  const value = optionalDate(obj, key);
  if (!value) throw new ValidationError(`'${key}' is verplicht`);
  return value;
}

export function optionalCents(obj: Obj, key: string): number | null {
  const value = obj[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(`'${key}' moet een positief bedrag in cent zijn`);
  }
  return value;
}
