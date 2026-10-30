import { Hono } from "hono";
import { productByCode, productByName } from "../products";
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
