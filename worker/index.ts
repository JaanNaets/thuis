import { Hono } from "hono";
import { requireAccess } from "./auth";
import { withPerson } from "./person";
import { quarter } from "./cron";
import { attachments } from "./routes/attachments";
import { events, listEvents } from "./routes/events";
import { insights } from "./routes/insights";
import { kinds, lists } from "./routes/lists";
import { me } from "./routes/me";
import { products } from "./routes/products";
import { push } from "./routes/push";
import { tags } from "./routes/tags";
import { listThings, things } from "./routes/things";
import { views } from "./routes/views";
import type { AppEnv } from "./types";
import { SHARE_PATH } from "../shared/manifest";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./validate";

const app = new Hono<AppEnv>().basePath("/api");

// 1. Wie ben je? (Cloudflare Access)
app.use("*", requireAccess);
// 2. Welke persoon is dat? Elke route kijkt daarna zelf na wat die persoon in de lijst mag (zie access.ts).
app.use("*", withPerson);

app.route("/me", me);
app.route("/lists", lists);
app.route("/lists", listThings);
app.route("/lists", listEvents);
app.route("/kinds", kinds);
app.route("/tags", tags);
app.route("/things", things);
app.route("/events", events);
app.route("/attachments", attachments);
app.route("/views", views);
app.route("/insights", insights);
app.route("/products", products);
app.route("/push", push);

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

export default {
  fetch: (request, env, ctx) => {
    // Delen met Thuis zonder service worker (de allereerste keer): naar /delen, zonder de foto.
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === SHARE_PATH) return Response.redirect(new URL(SHARE_PATH, url).toString(), 303);
    return app.fetch(request, env, ctx);
  },
  // Elk kwartier: herinneringen met een uur, timers, en om 7 u herhalen en herinneren (zie cron.ts en wrangler.jsonc).
  scheduled: (event, env, ctx) => ctx.waitUntil(quarter(env, new Date(event.scheduledTime))),
} satisfies ExportedHandler<AppEnv["Bindings"]>;
