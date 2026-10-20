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

/** Een id (uuid of vaste sleutel zoals "loc-keuken"), of null. */
export function optionalId(obj: Obj, key: string): string | null {
  return optionalString(obj, key, 64);
}

export function requiredId(obj: Obj, key: string): string {
  return requiredString(obj, key, 64);
}

export function idList(obj: Obj, key: string, max = 50): string[] {
  const value = obj[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max || value.some((v) => typeof v !== "string" || v.length > 64)) {
    throw new ValidationError(`'${key}' moet een lijst van id's zijn`);
  }
  return [...new Set(value as string[])];
}

export function optionalEnum<T extends string>(obj: Obj, key: string, values: readonly T[]): T | null {
  const value = obj[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new ValidationError(`'${key}' moet een van ${values.join(", ")} zijn`);
  }
  return value as T;
}

export function requiredEnum<T extends string>(obj: Obj, key: string, values: readonly T[]): T {
  const value = optionalEnum(obj, key, values);
  if (!value) throw new ValidationError(`'${key}' is verplicht`);
  return value;
}

/** Hoeveelheid: 0 of meer, op 3 cijfers na de komma. */
export function optionalQuantity(obj: Obj, key: string): number | null {
  const value = obj[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new ValidationError(`'${key}' moet een positief getal zijn`);
  }
  return Math.round(value * 1000) / 1000;
}

export function optionalBoolean(obj: Obj, key: string, fallback: boolean): boolean {
  const value = obj[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  throw new ValidationError(`'${key}' moet waar of onwaar zijn`);
}

/** Een conflict met wat al in de database staat (dubbele naam, nog in gebruik, ...). */
export class ConflictError extends Error {}

/**
 * Vertaalt een databasefout naar een duidelijke melding.
 * D1 zegt bv. "UNIQUE constraint failed: items.barcode" of "FOREIGN KEY constraint failed".
 */
export async function guard<T>(promise: Promise<T>, messages: { unique?: string; foreignKey?: string }): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (messages.unique && msg.includes("UNIQUE constraint failed")) throw new ConflictError(messages.unique);
    if (messages.foreignKey && msg.includes("FOREIGN KEY constraint failed")) throw new ConflictError(messages.foreignKey);
    throw err;
  }
}
