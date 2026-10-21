import { Hono } from "hono";
import { requireAccess } from "./auth";
import { withHousehold } from "./context";
import { materializeRecurring } from "./recurring";
import { expenses } from "./routes/expenses";
import { account, household } from "./routes/households";
import { items } from "./routes/items";
import { loyaltyCards } from "./routes/loyalty-cards";
import { projects } from "./routes/projects";
import { files, purchases } from "./routes/purchases";
import { receipts } from "./routes/receipts";
import { stats } from "./routes/stats";
import { categories, locations, members, tags, taxonomy } from "./routes/taxonomy";
import { vendors } from "./routes/vendors";
import type { AppEnv } from "./types";
import { ConflictError, ValidationError } from "./validate";

const app = new Hono<AppEnv>().basePath("/api");

// 1. Wie ben je? (Cloudflare Access)
app.use("*", requireAccess);

// 2. Zonder huishouden: je lidmaatschappen en een nieuw huishouden aanmaken.
app.route("/", account);

// 3. Al de rest hoort bij één huishouden, waar je lid van moet zijn (faalt gesloten, zie context.ts).
const scoped = new Hono<AppEnv>();
scoped.use("*", withHousehold);
scoped.route("/household", household);
scoped.route("/purchases", purchases);
scoped.route("/files", files);
scoped.route("/receipts", receipts);
scoped.route("/loyalty-cards", loyaltyCards);
scoped.route("/expenses", expenses);
scoped.route("/projects", projects);
scoped.route("/items", items);
scoped.route("/taxonomy", taxonomy);
scoped.route("/members", members);
scoped.route("/categories", categories);
scoped.route("/locations", locations);
scoped.route("/tags", tags);
scoped.route("/vendors", vendors);
scoped.route("/stats", stats);
app.route("/", scoped);

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

export default {
  fetch: app.fetch,
  // Elke nacht de terugkerende kosten inboeken (zie wrangler.jsonc → triggers).
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(materializeRecurring(env.DB));
  },
} satisfies ExportedHandler<AppEnv["Bindings"]>;
