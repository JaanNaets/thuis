// De app instellen (Jouw gegevens → App): waar ze opent (per toestel), meerdere apps op één toestel (elk een eigen
// icoon op je beginscherm met een eigen naam, dat naar een eigen pagina gaat), de snelkoppelingen als je lang op het
// icoon drukt (Android), wat er met een gedeelde foto gebeurt, of de AI voor jou mag lezen, welke formulieren je
// stilzette, en welke lijsten je niet in je menu of bij de + wil (een hulplijst zoals Winkels).
// Alles verwijst met ids; wat je niet (meer) kan bereiken, valt weg (`cleanAppSettings`, `keepReachable`).

/** Waar iets naartoe gaat: een overzicht (je borden: Geld, Agenda, …), een lijst, loggen met een formulier of een nieuw item. */
export type Destination =
  | { kind: "board"; board: string }
  | { kind: "list"; list: string }
  /** Loggen met een formulier (met tekst). `list`: enkel van vroeger, om het formulier terug te vinden (`legacyForm`). */
  | { kind: "form"; form: string; list?: string; text?: string }
  /** Een item toevoegen in een lijst (met tekst). */
  | { kind: "item"; list: string; text?: string };

export type DestinationKind = Destination["kind"];

export const DESTINATION_KINDS = {
  board: "Overzicht",
  list: "Lijst",
  form: "Formulier",
  item: "Nieuw item",
} as const satisfies Record<DestinationKind, string>;

export type AppDef = { id: string; name: string; to: Destination };
export type Shortcut = { name: string; to: Destination };

/** Een gedeelde foto: telkens vragen, of meteen als kasticket met een formulier (`list`: enkel van vroeger). */
export type ShareChoice = { kind: "ask" } | { kind: "receipt"; form: string; list?: string };

export type AppSettings = {
  apps: AppDef[];
  /** null = vanzelf: wat je het meest logt. */
  shortcuts: Shortcut[] | null;
  share: ShareChoice;
  /** Mag de AI voor jou lezen (✨)? Uit: geen ✨-knoppen, en de server weigert elke AI-vraag van jou. */
  ai: boolean;
  /** Formulieren of tags die je stilzette: geen melding bij iets nieuws daar. */
  muted: string[];
  /**
   * Lijsten die je verborg: niet in je menu, of niet bij de + (Toevoegen). In het menu ook tags: hun groep staat er dan
   * niet (een lijst staat er nog onder haar andere tags). Zoeken, Lijsten en Verbanden tonen alles.
   */
  hidden: Hidden;
  /** Jouw volgorde van de tags (in het menu en op Lijsten); wat er niet in staat, komt erachter, op naam. */
  tag_order: string[];
};

/** Waar een lijst staat (per persoon): in het menu (zijbalk, menublad) en bij de + (Toevoegen). */
export const LIST_PLACES = { menu: "In het menu", add: "Bij de +" } as const;
export type ListPlace = keyof typeof LIST_PLACES;
export type Hidden = Record<ListPlace, string[]>;
export const NO_HIDDEN: Hidden = { menu: [], add: [] };

export const MAX_APPS = 12;
export const MAX_SHORTCUTS = 4;
export const MAX_MUTED = 200;
export const MAX_HIDDEN = 500;
export const DEFAULT_SETTINGS: AppSettings = { apps: [], shortcuts: null, share: { kind: "ask" }, ai: true, muted: [], hidden: NO_HIDDEN, tag_order: [] };

/** De tags in jouw volgorde (`tag_order`), de rest erachter op naam. */
export function orderTags<T extends { id: string; name: string }>(tags: readonly T[], order: readonly string[]): T[] {
  const at = new Map(order.map((id, i) => [id, i]));
  return [...tags].sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity) || a.name.localeCompare(b.name, "nl", { sensitivity: "base" }));
}

/** Staat deze lijst voor jou op die plek? */
export const shownIn = (hidden: Hidden | undefined, place: ListPlace, list: string) => !hidden?.[place].includes(list);

/**
 * Waarom een formulier voor jou stil staat (geen melding bij iets nieuws): `"self"` als je het zelf stilzette, de id
 * van een tag als het via die tag is (dan laat enkel de tag het weer melden), of null.
 */
export function mutedBy(muted: readonly string[], form: { id: string; tags: readonly string[] }): "self" | string | null {
  if (muted.includes(form.id)) return "self";
  return form.tags.find((t) => muted.includes(t)) ?? null;
}

/** Staat de AI aan in deze (bewaarde, nog niet nagekeken) instellingen? Enkel een uitdrukkelijk `false` zet ze uit. */
export const aiAllowed = (raw: unknown): boolean => !(raw && typeof raw === "object" && (raw as Record<string, unknown>).ai === false);

const ID = /^[A-Za-z0-9-]{1,64}$/;
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

export function cleanDestination(raw: unknown): Destination | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  switch (o.kind) {
    case "board":
      return id(o.board) ? { kind: "board", board: o.board as string } : null;
    case "list":
      return id(o.list) ? { kind: "list", list: o.list as string } : null;
    case "item": {
      const t = text(o.text, 120);
      return id(o.list) ? { kind: "item", list: o.list as string, ...(t ? { text: t } : {}) } : null;
    }
    case "form": {
      const t = text(o.text, 120);
      // Vroeger: een item toevoegen was een formulier met `item`, en loggen een lijst met een soort (`type`, leeg: de eerste).
      if ((o.item === true || o.thing === true) && id(o.list)) return { kind: "item", list: o.list as string, ...(t ? { text: t } : {}) };
      const form = id(o.form) ?? id(o.type) ?? (id(o.list) ? "" : null);
      if (form === null) return null;
      return { kind: "form", form, ...(id(o.list) && !id(o.form) ? { list: o.list as string } : {}), ...(t ? { text: t } : {}) };
    }
    default:
      return null;
  }
}

export function cleanAppSettings(raw: unknown, newId: () => string = () => crypto.randomUUID().slice(0, 8)): AppSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const apps: AppDef[] = [];
  for (const a of Array.isArray(o.apps) ? o.apps.slice(0, MAX_APPS * 2) : []) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const to = cleanDestination(r.to);
    const name = text(r.name, 30);
    if (!to || !name) continue;
    const appId = id(r.id) && !seen.has(r.id as string) ? (r.id as string) : newId();
    seen.add(appId);
    apps.push({ id: appId, name, to });
    if (apps.length === MAX_APPS) break;
  }
  const shortcuts = Array.isArray(o.shortcuts)
    ? o.shortcuts
        .map((s) => {
          const r = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
          const to = cleanDestination(r.to);
          const name = text(r.name, 30);
          return to && name ? { name, to } : null;
        })
        .filter((s): s is Shortcut => s !== null)
        .slice(0, MAX_SHORTCUTS)
    : null;
  const s = o.share && typeof o.share === "object" ? (o.share as Record<string, unknown>) : {};
  const share: ShareChoice =
    s.kind === "receipt" && id(s.form) ? { kind: "receipt", form: s.form as string } : s.kind === "receipt" && id(s.list) ? { kind: "receipt", form: "aankoop", list: s.list as string } : { kind: "ask" };
  const muted = Array.isArray(o.muted) ? [...new Set(o.muted.map(id).filter((x): x is string => x !== null))].slice(0, MAX_MUTED) : [];
  const tagOrder = Array.isArray(o.tag_order) ? [...new Set(o.tag_order.map(id).filter((x): x is string => x !== null))].slice(0, MAX_HIDDEN) : [];
  return { apps, shortcuts, share, ai: aiAllowed(o), muted, hidden: cleanHidden(o.hidden), tag_order: tagOrder };
}

export function cleanHidden(raw: unknown): Hidden {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(id).filter((x): x is string => x !== null))].slice(0, MAX_HIDDEN) : []);
  return { menu: ids(o.menu), add: ids(o.add) };
}

export function destinationPath(d: Destination): string {
  switch (d.kind) {
    case "board":
      return boardPath(d.board);
    case "list":
      return `/lijsten/${d.list}`;
    case "item": {
      const query = d.text ? `?${new URLSearchParams({ tekst: d.text })}` : "";
      return `/lijsten/${d.list}/nieuw${query}`;
    }
    case "form": {
      const q = new URLSearchParams({ formulier: d.form });
      if (d.text) q.set("tekst", d.text);
      // Van vroeger (een lijst met een vertrekpunt, nog niet omgezet): loggen vanuit die lijst.
      if (d.list) q.set("nieuw", d.list);
      return `/loggen?${q}`;
    }
  }
}

/** Een formulier dat je kan bereiken: zijn naam, vertrekpunt, de lijsten die het invult, en of je ermee mag loggen. */
export type ReachForm = { name: string; base: string; fills: string[]; edit: boolean; receipt: boolean };

/** Wat je kan bereiken: je overzichten, de lijsten en formulieren die je ziet (en of je erin of ermee mag loggen). */
export type Reach = {
  boards: { id: string; name: string; icon?: string }[];
  lists: Map<string, { name: string; one: string | null; edit: boolean }>;
  forms: Map<string, ReachForm>;
  /** De tags die je ziet (verborgen in het menu, je volgorde); zonder: niet nagekeken. */
  tags?: Set<string>;
};

/**
 * Een formulier van vroeger terugvinden: van een lijst en een vertrekpunt of soort (een snelkoppeling, een actie of een
 * gedeelde foto van voor de losse formulieren). Het formulier zelf, dat van de omzetting voor die lijst en dat
 * vertrekpunt (`<lijst>-<vertrekpunt>`), of een formulier met dat vertrekpunt (leeg: om het even welk) dat die lijst
 * invult. `pick`: enkel zulke formulieren (een kasticket).
 */
export function legacyForm(forms: Map<string, ReachForm>, form: string, list: string | undefined, pick: (f: ReachForm) => boolean = () => true): string | null {
  const ok = (id: string) => forms.has(id) && pick(forms.get(id)!);
  if (form && ok(form)) return form;
  if (!list) return null;
  if (form && ok(`${list}-${form}`)) return `${list}-${form}`;
  return [...forms].find(([, f]) => pick(f) && f.fills.includes(list) && (!form || f.base === form))?.[0] ?? null;
}

export function reachable(d: Destination, reach: Reach): boolean {
  switch (d.kind) {
    case "board":
      return reach.boards.some((b) => b.id === d.board);
    case "list":
      return reach.lists.has(d.list);
    case "item": {
      const l = reach.lists.get(d.list);
      return Boolean(l?.edit && l.one);
    }
    case "form":
      return Boolean(reach.forms.get(d.form)?.edit);
  }
}

/** Hoe een bestemming heet ("Keuken", "Geld", "Wijnen", "Gegeten loggen", "Wijn toevoegen"). */
export function destinationLabel(d: Destination, reach: Reach): string {
  switch (d.kind) {
    case "board":
      return reach.boards.find((b) => b.id === d.board)?.name ?? "Overzicht";
    case "list":
      return reach.lists.get(d.list)?.name ?? "Lijst";
    case "item":
      return `${reach.lists.get(d.list)?.one ?? "Item"} toevoegen`;
    case "form":
      return `${reach.forms.get(d.form)?.name ?? "Iets"} loggen`;
  }
}

/** Een bestemming van vroeger met het formulier dat ze bedoelde (zie `legacyForm`), of null als je dat niet bereikt. */
function upgraded(d: Destination, reach: Reach): Destination | null {
  if (d.kind !== "form" || !d.list) return d;
  const form = legacyForm(reach.forms, d.form, d.list, (f) => f.edit);
  return form ? { kind: "form", form, ...(d.text ? { text: d.text } : {}) } : null;
}

export function keepReachable(s: AppSettings, reach: Reach): AppSettings {
  const kept = (d: Destination) => {
    const u = upgraded(d, reach);
    return u && reachable(u, reach) ? u : null;
  };
  const receipt = s.share.kind === "receipt" ? legacyForm(reach.forms, s.share.form, s.share.list, (f) => f.edit && f.receipt) : null;
  const share: ShareChoice = receipt ? { kind: "receipt", form: receipt } : { kind: "ask" };
  return {
    apps: s.apps.flatMap((a) => {
      const to = kept(a.to);
      return to ? [{ ...a, to }] : [];
    }),
    shortcuts: s.shortcuts && s.shortcuts.flatMap((x) => {
      const to = kept(x.to);
      return to ? [{ ...x, to }] : [];
    }),
    share,
    ai: s.ai,
    muted: s.muted,
    hidden: { menu: s.hidden.menu.filter((x) => reach.lists.has(x) || (reach.tags?.has(x) ?? false)), add: s.hidden.add.filter((l) => reach.lists.has(l)) },
    tag_order: reach.tags ? s.tag_order.filter((t) => reach.tags!.has(t)) : s.tag_order,
  };
}

export const appPath = (appId: string) => `/app/${appId}`;
/** Een bord (overzicht) heeft een eigen adres; het eerste is ook het beginscherm (/). */
export const boardPath = (board: string) => `/bord/${encodeURIComponent(board)}`;

export function sameDestination(a: Destination, b: Destination): boolean {
  const key = (d: Destination) => JSON.stringify(cleanDestination(d));
  return key(a) === key(b);
}
