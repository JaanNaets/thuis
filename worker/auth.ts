import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "./types";

// De sleutels van Access worden per isolate gecachet, niet per aanvraag opgehaald.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

/**
 * Cloudflare Access staat vóór de app en zet een ondertekend JWT in elke aanvraag.
 * We controleren dat JWT zelf, zodat niemand de app kan bereiken door Access te omzeilen.
 *
 * Lokaal (npm run dev) is er geen Access; daar gebruiken we DEV_USER uit .dev.vars. Om met meerdere mensen te
 * testen, kan een test lokaal een ander e-mailadres meegeven in de header X-Dev-User.
 * Die uitzonderingen gelden enkel op localhost én met DEV_USER, zodat een verkeerd gezette variabele
 * in productie de beveiliging niet kan uitschakelen.
 */
export const requireAccess = createMiddleware<AppEnv>(async (c, next) => {
  const isLocal = ["localhost", "127.0.0.1"].includes(new URL(c.req.url).hostname);
  if (isLocal && c.env.DEV_USER) {
    c.set("user", c.req.header("x-dev-user") || c.env.DEV_USER);
    return next();
  }

  const { TEAM_DOMAIN, POLICY_AUD } = c.env;
  if (!TEAM_DOMAIN || !POLICY_AUD) {
    return c.json({ error: "Access is nog niet geconfigureerd (TEAM_DOMAIN / POLICY_AUD)" }, 500);
  }

  const token = c.req.header("cf-access-jwt-assertion");
  if (!token) {
    return c.json({ error: "Niet aangemeld" }, 401);
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(TEAM_DOMAIN), {
      issuer: TEAM_DOMAIN,
      audience: POLICY_AUD,
    });
    c.set("user", typeof payload.email === "string" ? payload.email : String(payload.sub));
  } catch {
    return c.json({ error: "Ongeldige aanmelding" }, 401);
  }

  return next();
});
