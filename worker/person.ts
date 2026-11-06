import { createMiddleware } from "hono/factory";
import { TONES, type Person, type Tone } from "../shared/types";
import type { AppEnv } from "./types";

/**
 * Koppelt elke aanvraag aan een persoon. Wie voor het eerst aanmeldt, krijgt een persoon (zonder lijsten).
 * Bestaat er al een persoon met dit e-mailadres (iemand voegde je toe), dan ben je die persoon.
 */
export const withPerson = createMiddleware<AppEnv>(async (c, next) => {
  const email = c.get("user").trim().toLowerCase();
  const db = c.env.DB;
  let person = await db.prepare("SELECT id, name, email, color, iban FROM people WHERE email = ?").bind(email).first<Person>();
  if (!person) {
    const name =
      email
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (ch) => ch.toUpperCase())
        .slice(0, 60) || "Ik";
    const color = TONES[Math.floor(Math.random() * TONES.length)] as Tone;
    person = await db
      .prepare("INSERT INTO people (id, name, email, color) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET email = email RETURNING id, name, email, color, iban")
      .bind(crypto.randomUUID(), name, email, color)
      .first<Person>();
  }
  c.set("person", person!);
  return next();
});
