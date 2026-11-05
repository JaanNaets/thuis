// Het manifest van de app (wat een gsm nodig heeft om Thuis als app te installeren), gemaakt door de Worker zodat het
// per persoon kan: lang op het icoon drukken toont je drie meestgebruikte lijsten (Android), en een foto of tekst
// delen met Thuis kan (share_target, Android). Elke lijst heeft ook een eigen manifest: zo zet je "Bijvulling" als
// eigen icoon op je beginscherm, dat meteen het formulier opent (zie /snel/:project/:lijst).

import { addPath, type AddTarget } from "./quickadd.ts";

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

/** Zoveel lijsten als snelkoppeling op het app-icoon. */
export const SHORTCUT_LISTS = 3;

/** Waar een gedeelde foto of tekst binnenkomt (de service worker vangt dit op, zie sw/sw.js en /delen). */
export const SHARE_PATH = "/delen";

const shortcut = (name: string, url: string) => ({ name, short_name: name.slice(0, 12), url, icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] });

/** Het manifest van de app: met je meestgebruikte lijsten als snelkoppeling, Toevoegen en Agenda. */
export function appManifest(targets: AddTarget[]) {
  return {
    id: "/",
    name: "Thuis",
    short_name: "Thuis",
    start_url: "/",
    ...BASE,
    shortcuts: [
      ...targets.slice(0, SHORTCUT_LISTS).map((t) => shortcut(t.name, addPath(t))),
      shortcut("Toevoegen", "/?toevoegen=1"),
      shortcut("Agenda", "/agenda"),
    ],
    share_target: {
      action: SHARE_PATH,
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url", files: [{ name: "foto", accept: ["image/*", "application/pdf"] }] },
    },
  };
}

/** Het pad van het icoon voor één lijst: opent meteen haar formulier. */
export const quickPath = (projectId: string, typeId: string) => `/snel/${projectId}/${typeId}`;

/** Het manifest voor één lijst als eigen icoon op je beginscherm ("Bijvulling"). */
export function listManifest(t: { project_id: string; type_id: string; name: string }) {
  const path = quickPath(t.project_id, t.type_id);
  return { id: path, name: t.name, short_name: t.name.slice(0, 12), start_url: path, ...BASE };
}
