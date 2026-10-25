import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

// Bestanden uit public/ die offline beschikbaar moeten zijn.
const PUBLIC_FILES = ["/manifest.webmanifest", "/icon.svg", "/icon-192.png"];

// Enkel nodig om iets toe te voegen of te bekijken (scanner, PDF), niet om een barcode te tonen.
// Die worden pas bewaard wanneer ze een eerste keer gebruikt worden.
const SKIP_PRECACHE = /zxing_reader|pdf\.worker|assets\/pdf-|ponyfill|PdfPages|\.map$/;

/** Maakt dist/client/sw.js met de lijst van alle gebouwde bestanden die offline moeten werken. */
function serviceWorker(): Plugin {
  return {
    name: "huishouden-service-worker",
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;

      const built = Object.keys(bundle)
        .filter((file) => file.startsWith("assets/") && !SKIP_PRECACHE.test(file))
        .map((file) => `/${file}`);
      const precache = ["/", ...PUBLIC_FILES, ...built];
      const template = readFileSync("sw/sw.js", "utf8");
      const version = createHash("sha256").update(template).update(precache.join("\n")).digest("hex").slice(0, 12);

      const source = template
        .replace('const VERSION = "__VERSION__";', `const VERSION = "${version}";`)
        .replace("const PRECACHE = __PRECACHE__;", `const PRECACHE = ${JSON.stringify(precache, null, 2)};`);
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Workers AI draait altijd bij Cloudflare, ook tijdens het ontwikkelen. Gewoon `npm run dev` werkt
    // volledig lokaal (zonder AI); `npm run dev:ai` gebruikt de echte AI en vraagt een Cloudflare-login.
    cloudflare({ remoteBindings: mode === "ai" }),
    serviceWorker(),
  ],
  // De barcodebibliotheek is bewust een apart, groot bestand dat pas laadt als er een code getoond wordt.
  build: { chunkSizeWarningLimit: 1000 },
}));
