import { Hono } from "hono";
import { requireAccess } from "./auth";
import { purchases, files } from "./routes/purchases";
import { loyaltyCards } from "./routes/loyalty-cards";
import type { AppEnv } from "./types";
import { ValidationError } from "./validate";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", requireAccess);

app.get("/me", (c) => c.json({ email: c.get("user") }));
app.route("/purchases", purchases);
app.route("/files", files);
app.route("/loyalty-cards", loyaltyCards);

app.notFound((c) => c.json({ error: "Niet gevonden" }, 404));
app.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
  if (err instanceof SyntaxError) return c.json({ error: "Ongeldige JSON" }, 400);
  console.error(err);
  return c.json({ error: "Er ging iets mis" }, 500);
});

export default app;
