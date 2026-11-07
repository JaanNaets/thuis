// Het manifest van de app (wat een gsm nodig heeft om Heystack als app te installeren), gemaakt door de Worker zodat het
// per persoon kan: lang op het icoon drukken toont wat je het meest logt (Android), en een foto of tekst delen met
// Heystack kan (share_target, Android). Een eigen app (zie shared/apps.ts) heeft een eigen manifest.

const ICONS = [
  { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
  { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
  { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

const BASE = {
  lang: "nl",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  icons: ICONS,
  orientation: "any",
};

/** Zoveel formulieren als snelkoppeling op het app-icoon. */
export const SHORTCUT_LISTS = 3;

/** Waar een gedeelde foto of tekst binnenkomt (de service worker vangt dit op, zie sw/sw.js en /delen). */
export const SHARE_PATH = "/delen";

const shortcut = (name: string, url: string) => ({ name, short_name: name.slice(0, 12), url, icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] });

/**
 * Het manifest van de app: je eigen snelkoppelingen (`chosen`, zie shared/apps.ts), of vanzelf wat je het meest logt
 * (`often`) en Toevoegen.
 */
export function appManifest(often: { name: string; url: string }[], chosen: { name: string; url: string }[] | null = null) {
  return {
    id: "/",
    name: "Heystack",
    short_name: "Heystack",
    start_url: "/",
    ...BASE,
    shortcuts: chosen
      ? chosen.map((c) => shortcut(c.name, c.url))
      : [...often.slice(0, SHORTCUT_LISTS).map((t) => shortcut(t.name, t.url)), shortcut("Toevoegen", "/?toevoegen=1")],
    share_target: {
      action: SHARE_PATH,
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url", files: [{ name: "foto", accept: ["image/*", "application/pdf"] }] },
    },
  };
}

/** Het manifest van een eigen app (zie shared/apps.ts): een eigen icoon met haar naam, dat naar haar pagina gaat. */
export function ownAppManifest(app: { id: string; name: string }) {
  const path = `/app/${app.id}`;
  return { id: path, name: app.name, short_name: app.name.slice(0, 12), start_url: path, ...BASE };
}
