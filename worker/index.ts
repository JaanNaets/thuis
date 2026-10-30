import { Hono } from "hono";
import { requireAccess } from "./auth";
import { withPerson } from "./context";
import { files, items, projectItems, search } from "./routes/items";
import { me } from "./routes/me";
import { products } from "./routes/products";
import { people, projects, roles, tags, types } from "./routes/projects";
import type { AppEnv } from "./types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./validate";

const app = new Hono<AppEnv>().basePath("/api");

// 1. Wie ben je? (Cloudflare Access)
app.use("*", requireAccess);
// 2. Welke persoon is dat? Elke route controleert daarna zelf wat die persoon in het project mag (zie context.ts).
app.use("*", withPerson);

app.route("/me", me);
app.route("/projects", projects);
app.route("/projects", projectItems);
app.route("/types", types);
app.route("/roles", roles);
app.route("/people", people);
app.route("/tags", tags);
app.route("/items", items);
app.route("/files", files);
app.route("/search", search);
app.route("/products", products);

app.notFound((c) => c.json({ error: "Niet gevonden" }, 404));
app.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
  if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
  if (err instanceof ConflictError) return c.json({ error: err.message }, 409);
  // Een id die niet (meer) bestaat, bv. iets dat net iemand anders verwijderde.
  if (err instanceof Error && err.message.includes("FOREIGN KEY constraint failed")) {
    return c.json({ error: "Iets waarnaar je verwijst, bestaat niet (meer). Herlaad de pagina." }, 400);
  }
  if (err instanceof SyntaxError) return c.json({ error: "Ongeldige JSON" }, 400);
  console.error(err);
  return c.json({ error: "Er ging iets mis" }, 500);
});

export default { fetch: app.fetch } satisfies ExportedHandler<AppEnv["Bindings"]>;
