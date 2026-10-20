import { Hono } from "hono";
import { requireAccess } from "./auth";
import { expenses } from "./routes/expenses";
import { items } from "./routes/items";
import { loyaltyCards } from "./routes/loyalty-cards";
import { files, purchases } from "./routes/purchases";
import { receipts } from "./routes/receipts";
import { categories, ensureMember, locations, members, tags, taxonomy } from "./routes/taxonomy";
import { vendors } from "./routes/vendors";
import type { AppEnv } from "./types";
import { ConflictError, ValidationError } from "./validate";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", requireAccess);

// Wie aanmeldt, is meteen lid van het huishouden (zie ensureMember).
app.get("/me", async (c) => c.json({ email: c.get("user"), member: await ensureMember(c.env.DB, c.get("user")) }));
app.route("/purchases", purchases);
app.route("/files", files);
app.route("/receipts", receipts);
app.route("/loyalty-cards", loyaltyCards);
app.route("/expenses", expenses);
app.route("/items", items);
app.route("/taxonomy", taxonomy);
app.route("/members", members);
app.route("/categories", categories);
app.route("/locations", locations);
app.route("/tags", tags);
app.route("/vendors", vendors);

app.notFound((c) => c.json({ error: "Niet gevonden" }, 404));
app.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
  if (err instanceof ConflictError) return c.json({ error: err.message }, 409);
  // Een id die niet (meer) bestaat, bv. een categorie die net iemand anders verwijderde.
  if (err instanceof Error && err.message.includes("FOREIGN KEY constraint failed")) {
    return c.json({ error: "Iets waarnaar je verwijst, bestaat niet (meer). Herlaad de pagina." }, 400);
  }
  if (err instanceof SyntaxError) return c.json({ error: "Ongeldige JSON" }, 400);
  console.error(err);
  return c.json({ error: "Er ging iets mis" }, 500);
});

export default app;
