import { Hono } from "hono";
import { nevoByName, productByCode, productByName } from "../products";
import { nevoCredit } from "../../shared/nevo";
import { NEVO_DATA } from "../../shared/nevo-data";
import { getRates } from "../rates";
import type { AppEnv } from "../types";
import { NotFoundError } from "../validate";

/**
 * Productinfo (zie shared/product.ts): op barcode (/products/3017620422003) of op naam en merk
 * (/products?naam=Nutella&merk=Ferrero). Voor iedereen die aangemeld is; er staat niets van jou of je projecten in.
 */
export const products = new Hono<AppEnv>();

const unreachable = { error: "Open Food Facts is even niet bereikbaar. Vul het zelf in, of probeer straks opnieuw." };

products.get("/", async (c) => {
  const name = c.req.query("naam") ?? "";
  try {
    const found = await productByName(c.env.DB, name, c.req.query("merk") ?? null);
    if (!found) throw new NotFoundError("Geen product gevonden met die naam.");
    return c.json(found);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    return c.json(unreachable, 503);
  }
});

/**
 * Een gewoon voedingsmiddel op naam in NEVO (`?naam=appel`), zonder netwerk: voor wat je typt in een lijst met
 * productinfo. Geen match of geen NEVO: 404. Met de bronvermelding die het RIVM vraagt.
 */
products.get("/nevo", (c) => {
  const found = nevoByName(c.req.query("naam") ?? "");
  if (!found) throw new NotFoundError("Niet in NEVO.");
  return c.json({ ...found, credit: nevoCredit(NEVO_DATA.version) });
});

products.get("/:code", async (c) => {
  try {
    const found = await productByCode(c.env.DB, c.req.param("code"));
    if (!found) throw new NotFoundError("Dit product staat (nog) niet in Open Food Facts.");
    return c.json(found);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    return c.json(unreachable, 503);
  }
});

/** De dagkoersen van de ECB (1 EUR = koers × munt), om een bedrag in een vreemde munt om te rekenen. */
export const rates = new Hono<AppEnv>();

rates.get("/", async (c) => {
  const found = await getRates(c.env.DB);
  return found ? c.json(found) : c.json({ error: "De wisselkoersen zijn even niet bereikbaar. Vul het bedrag in euro in." }, 503);
});
