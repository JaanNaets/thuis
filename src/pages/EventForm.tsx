import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import { FIELD_TYPES, type Attributes, type FieldDef, type Interval } from "../../shared/fields";
import { defaultSharers } from "../../shared/ledger";
import { stockOp } from "../../shared/cells";
import { formEats } from "../../shared/food";
import { brusselsNow, fillsLists, mainGroup, namedLines, startsPlanned, type EventView, type FormDetail, type KindInfo, type LineGroup, type Status, type ItemRef } from "../../shared/model";
import { fold, readEvent, type ParsedEvent } from "../../shared/parse";
import { formReads } from "../../shared/photoread";
import { buysWith, hasPrice, receiptForms, type Targets } from "../../shared/targets";
import { niceName } from "../../shared/receipt";
import type { Person } from "../../shared/types";
import { api, useApi } from "../api";
import { RequiredMark, SubmitButton, Switch } from "../components/Controls";
import { attributesDraft, buildAttributes, buildShares, FieldInputs, sharesDraft, SharesField, type AttributeDraft, type SharesDraft } from "../components/Fields";
import { AiMark } from "../components/Fields";
import { FormPicker } from "../components/FormPicker";
import { Icon } from "../components/Icon";
import { buildLine, emptyLine, lineDraft, LinesEditor, renamed, startLines, type LineDraft } from "../components/Lines";
import { EmptyState, PageHead } from "../components/Page";
import { PhotoButton } from "../components/PhotoPicker";
import { useToast } from "../components/Toast";
import { centsToInput, parseEuro } from "../format";
import { prepareUpload } from "../image";
import { enqueue, isOffline } from "../outbox";
import { Link, useNavigate } from "../router";
import { clearShared, sharedFile } from "../shared-file";
import { useSession } from "../session";
import { allEdit } from "./ItemForm";
import type { EventPage } from "../components/Log";

type EventDetail = EventPage & { event: EventView; can_edit: boolean };

/** Wat een foto opleverde (POST /forms/:id/read-photo): een kasticket bij een aankoop, anders de velden. */
type ReceiptRead = {
  kind: "receipt";
  store: ItemRef | null;
  store_text: string | null;
  date: string | null;
  total: number | null;
  lines: {
    name: string;
    item: ItemRef | null;
    amount: number;
    unit: string | null;
    price: number | null;
  }[];
  message?: string;
};
type FormRead = { kind: "form"; name: string | null; date: string | null; amount: number | null; data: Attributes; estimate: boolean; message?: string };

const EVERY: { value: string; label: string; every: Interval | null }[] = [
  { value: "", label: "Niet", every: null },
  { value: "1-day", label: "Elke dag", every: { n: 1, unit: "day" } },
  { value: "1-week", label: "Elke week", every: { n: 1, unit: "week" } },
  { value: "2-week", label: "Om de 2 weken", every: { n: 2, unit: "week" } },
  { value: "1-month", label: "Elke maand", every: { n: 1, unit: "month" } },
  { value: "3-month", label: "Elke 3 maanden", every: { n: 3, unit: "month" } },
  { value: "6-month", label: "Elke 6 maanden", every: { n: 6, unit: "month" } },
  { value: "1-year", label: "Elk jaar", every: { n: 1, unit: "year" } },
];

/**
 * Loggen met een formulier (`/loggen`, met `?formulier=`, `?item=`, `?tekst=`, `?nieuw=<lijst>` of `?gepland=1`), of een
 * gebeurtenis bewerken (`/gebeurtenissen/:eventId/bewerken`). Je kiest uit de formulieren waarmee je mag loggen. Zie
 * STIJLBOEK.md → Formulier en Lijnen.
 */
export function EventFormPage() {
  const { eventId } = useParams();
  const { data: existing, error: loadError } = useApi<EventDetail>(eventId ? `/events/${eventId}` : null);
  const { data: targets, error } = useApi<Targets>("/me/targets");
  if (error || loadError) return <p className="error page">{error ?? loadError}</p>;
  if (!targets || (eventId && !existing)) return <p className="page muted">Laden…</p>;
  if (existing && !existing.can_edit) return <p className="page muted">Je mag met dit formulier enkel kijken.</p>;
  // De formulieren waarmee je mag loggen, en dat van de gebeurtenis die je bewerkt (ook een Aanpassing).
  const kinds = [...targets.kinds, ...(existing?.kinds ?? []).filter((k) => k.id === existing!.event.kind && !targets.kinds.some((t) => t.id === k.id))];
  if (!kinds.length)
    return (
      <div className="page">
        <PageHead title="Loggen" back={{ to: -1, label: "Terug" }} />
        <EmptyState
          icon="note"
          title="Nog geen formulier"
          action={
            <Link to="/formulieren/nieuw" className="btn btn-primary">
              <Icon name="plus" size={16} /> Formulier
            </Link>
          }
        />
      </div>
    );
  return <EventForm key={eventId ?? "nieuw"} kinds={kinds} targets={targets} existing={existing ?? null} />;
}

function EventForm({ kinds, targets: logTargets, existing }: { kinds: KindInfo[]; targets: Targets; existing: EventDetail | null }) {
  const event = existing?.event ?? null;
  const toast = useToast();
  const navigate = useNavigate();
  const { person, lists, ai } = useSession();
  const [params] = useSearchParams();
  const { data: people } = useApi<Person[]>("/me/people");
  const itemParam = params.get("item");
  const { data: preset } = useApi<{ items: ItemRef[] }>(itemParam && !event ? `/items?ids=${itemParam}` : null);
  // Waar je vandaan komt: de lijst (`?nieuw=`) of die van het item; de formulieren die haar invullen, eerst.
  const home = params.get("nieuw") ?? preset?.items[0]?.list_id ?? null;
  const homeList = lists.find((l) => l.id === home) ?? null;
  const fillsHome = (k: KindInfo) => Boolean(home) && fillsLists(k).includes(home!);

  const wantedKind = params.get("formulier") ?? params.get("soort");
  const [kindId, setKindId] = useState<string>(() => event?.kind ?? (wantedKind && kinds.some((k) => k.id === wantedKind) ? wantedKind : (kinds.find(fillsHome) ?? kinds[0]).id));
  const chosenKind = useRef(Boolean(event || wantedKind));
  const kind: KindInfo = kinds.find((k) => k.id === kindId) ?? kinds[0];
  // Wie bij het formulier is (een uitgave is standaard gelijk verdeeld over hen).
  const { data: form } = useApi<FormDetail>(kind.system ? null : `/forms/${kind.id}`);
  // Waar een item komt als je logt vanaf dat item, en wat erbij komt in een voorraad (een aankoop).
  const mainG = mainGroup(kind);
  const main = mainG.key;
  // De groep waar iets bij komt (een aankoop): daar komen de lijnen van een kasticket.
  const addsG = kind.parts.groups.find((g) => !g.fresh && stockOp(kind.does, g.key) === "bij") ?? null;
  const adds = addsG?.key ?? null;
  // Waar of bij wie (de winkel van een kasticket): de eerste groep met die rol.
  const storeG = kind.parts.groups.find((g) => g.role === "bij" && !g.fresh) ?? null;
  // Een formulier dat koopt (een kasticket, een prijs in je tekst): een dat de lijst invult eerst, dan je meestgebruikte.
  const buyers = receiptForms(logTargets);
  const buyKind = buyers.find(fillsHome) ?? buyers[0] ?? null;

  const now = brusselsNow();
  // Vooraf ingevuld door een actie op het overzicht (`?vooraf=`): de omschrijving en velden van de soort.
  const prefill = useMemo(() => {
    try {
      const raw = JSON.parse(params.get("vooraf") ?? "null");
      return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }, [params]);
  const [typed, setTyped] = useState(() => (event ? "" : (params.get("tekst") ?? "")));
  const [name, setName] = useState(event?.name ?? (typeof prefill.name === "string" ? prefill.name : ""));
  const [day, setDay] = useState((event?.at ?? now).slice(0, 10));
  const [time, setTime] = useState(event ? event.at.slice(11, 16) : kind.parts.duration ? now.slice(11, 16) : "");
  const [endTime, setEndTime] = useState(event?.end_at?.slice(11, 16) ?? "");
  // Gepland als je erom vroeg (`?gepland=1`) of als het formulier gepland begint; tot je de schakelaar zelf zet.
  const askedPlanned = Boolean(params.get("gepland"));
  const [status, setStatus] = useState<Status>(event?.status ?? (startsPlanned(kind, askedPlanned) ? "gepland" : "gebeurd"));
  const statusChosen = useRef(Boolean(event));
  // Lijsten waarin een nieuw item kan komen. Iets nieuws dat erbij komt (een wijn die er nog niet staat): in de lijst
  // waar je vandaan kwam (`?nieuw=`), anders in deze. Niet bij iets gepland: een wijn op de boodschappenlijst komt pas in
  // Wijnen als je hem koopt.
  const targets = lists.filter((l) => l.one && (l.role === "lid" || l.role === "beheerder") && !l.archived);
  const defaultNew = [params.get("nieuw")].find((id) => id && targets.some((t) => t.id === id)) ?? "";
  const newIn = status === "gepland" ? "" : defaultNew;
  // Vooraf ingevuld in het palet (stap voor stap, Alles invullen): het bedrag ($amount) en hoeveel van het item ($qty).
  const [amount, setAmount] = useState(centsToInput(event?.amount ?? (typeof prefill.$amount === "number" ? prefill.$amount : null)));
  const [paidBy, setPaidBy] = useState(event ? (event.paid_by ?? "") : person.id);
  const [toPerson, setToPerson] = useState(event?.to_person ?? "");
  // Een nieuwe uitgave met een gedeeld formulier: gelijk over wie ermee logt (shared/ledger.ts), tot je de verdeling zelf kiest.
  const sharers = (form?.people ?? []).filter((p) => p.direct !== "geen").map((p) => ({ id: p.person.id, role: p.role }));
  const defaultShares = (k: KindInfo): SharesDraft => {
    const ids = defaultSharers(k.parts, sharers);
    return ids.length ? { mode: "equal", people: ids, values: {} } : sharesDraft(undefined);
  };
  const [shares, setShares] = useState<SharesDraft>(() => (event ? sharesDraft(event.split ?? undefined) : defaultShares(kind)));
  const sharesChosen = useRef(Boolean(event));
  useEffect(() => {
    if (!sharesChosen.current && !event) setShares(defaultShares(kind));
    // Bij een ander formulier en als zijn mensen er zijn; die veranderen niet terwijl je invult.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind.id, form]);
  const [draft, setDraft] = useState<AttributeDraft>(() => attributesDraft(kind.fields, event?.data ?? (Object.fromEntries(Object.entries(prefill).filter(([k]) => k !== "name")) as Attributes)));
  const [lines, setLines] = useState<LineDraft[]>(() =>
    event
      ? event.lines.map((l) =>
          lineDraft(
            l,
            existing?.items.find((t) => t.id === l.item_id),
          ),
        )
      : startLines(kind, main),
  );
  const [repeat, setRepeat] = useState(() => {
    const r = event?.repeat?.every;
    return r ? (EVERY.find((e) => e.every?.n === r.n && e.every.unit === r.unit)?.value ?? "") : "";
  });
  const [photo, setPhoto] = useState<File | null>(null);
  // Een gedeelde foto wacht op een tik op Foto lezen (de AI start enkel na jouw keuze); per lijn de naam op het ticket.
  const [pending, setPending] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  // Waar wat ingevuld is vandaan komt: "Gelezen met AI" of "Geschat met AI".
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const access = useMemo(() => allEdit(kind.fields), [kind.fields]);
  // Leest dit formulier een foto (Instellen van het formulier, en de AI staat voor jou aan)?
  const reads = Boolean(ai && !event && formReads(kind));

  // Een item uit het adres (Loggen vanaf een item): meteen als eerste lijn.
  useEffect(() => {
    const t = preset?.items[0];
    const qty = typeof prefill.$qty === "number" ? String(prefill.$qty).replace(".", ",") : "";
    if (t) setLines((ls) => (ls.every((l) => !l.item && !l.text) ? [{ ...emptyLine(mainG, t), unit: t.unit ?? "", amount: qty }, ...ls.filter((l) => l.group !== main)] : ls));
  }, [preset]);
  // Een gedeelde foto (Android: delen met Heystack, of de foto bij de +): ze komt bij wat je logt. Met `lezen=1` koos je
  // al om ze te laten lezen; anders wacht ze op een tik op Foto lezen. Een kasticket is een aankoop.
  const sharedTaken = useRef(false);
  useEffect(() => {
    const receipt = params.get("kasticket") === "gedeeld";
    // Eén keer (ook als React het effect twee keer draait): anders leest de AI dezelfde foto twee keer.
    if (sharedTaken.current || event || (!receipt && params.get("foto") !== "gedeeld")) return;
    sharedTaken.current = true;
    // Een kasticket: het gekozen formulier als het koopt, anders een formulier dat koopt (Aankoop).
    const buy = buysWith(kind) ? kind.id : (buyKind?.id ?? null);
    if (receipt && buy) {
      chosenKind.current = true;
      setKindId(buy);
    }
    sharedFile().then((f) => {
      if (!f) return;
      setPhoto(f);
      if (params.get("lezen") === "1" && reads) readPhoto(f);
      else if (receipt || reads) setPending(f);
      else clearShared();
    });
  }, []);
  // Een ander formulier: zijn (lege) velden; lege lijnen gaan weg, en de eerste groep krijgt er een.
  const firstKind = useRef(kindId);
  useEffect(() => {
    if (firstKind.current === kindId) return;
    firstKind.current = "";
    setDraft(attributesDraft(kind.fields, {}));
    setLines((ls) => {
      const kept = ls.filter((l) => l.item || l.text);
      return kept.length ? kept : startLines(kind, main);
    });
    if (!statusChosen.current) setStatus(startsPlanned(kind, askedPlanned) ? "gepland" : "gebeurd");
  }, [kindId]);

  // Wat je typt ("pasta 300 g", "tankbeurt 84,50 52 liter"), live in de velden (shared/parse.ts). Enkel wat de tekst
  // er zelf zette, verandert mee; wat je daarna zelf aanpaste, blijft staan (en wissen zet terug wat er stond).
  const startTime = kind.parts.duration ? now.slice(11, 16) : "";
  const auto = useRef({
    name: "",
    amount: "",
    day: now.slice(0, 10),
    time: startTime,
    data: {} as AttributeDraft,
    lines: new Map<string, string>(),
  });
  useEffect(() => {
    if (event) return;
    let text = typed.trim();
    // Begint de tekst met een formulier ("gegeten pasta"), dan dat formulier.
    const lead = kinds.find((k) => fold(text) === fold(k.name) || fold(text).startsWith(`${fold(k.name)} `));
    if (lead) {
      text = text.slice(lead.name.length).trim();
      if (lead.id !== kindId) {
        auto.current.data = {};
        setKindId(lead.id);
        return;
      }
    } else if (!chosenKind.current && !kind.parts.money && hasPrice(text) && buyKind) {
      // Een prijs zonder gekozen formulier: een formulier dat koopt.
      setKindId(buyKind.id);
      return;
    }
    let stale = false;
    const timer = window.setTimeout(
      async () => {
        const found = text
          ? (
              await api
                .get<{
                  items: ItemRef[];
                }>(`/items?in=${encodeURIComponent(text)}&limit=10`)
                .catch(() => ({ items: [] as ItemRef[] }))
            ).items
          : [];
        if (stale) return;
        // De groep van het formulier uit de lijst van het item; uit een voorraad: de groep die de voorraad verandert;
        // anders wat het item meestal is (Colruyt: bij), als het formulier die groep heeft.
        const groupFor = (t: ItemRef): LineGroup => {
          // Een groep die een nieuwe rij maakt, kiest geen bestaand item.
          const groups = kind.parts.groups.filter((g) => !g.fresh);
          const listed = groups.find((g) => g.lists.includes(t.list_id));
          if (listed) return listed;
          const stocked = t.stock ? groups.find((g) => !g.lists.length && stockOp(kind.does, g.key)) : undefined;
          if (stocked) return stocked;
          const usual = t.usual ? groups.find((g) => !g.lists.length && g.role === t.usual) : undefined;
          return usual ?? groups.find((g) => !g.lists.length && !stockOp(kind.does, g.key)) ?? mainG;
        };
        const parsed = readEvent(text, {
          today: now.slice(0, 10),
          money,
          fields: kind.fields,
          items: found.map((t) => ({
            id: t.id,
            name: t.name,
            unit: t.unit,
            ...((g) => ({ role: g.role, group: g.key }))(groupFor(t)),
          })),
        });
        applyTyped(parsed, found);
      },
      text ? 250 : 0,
    );
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [typed, kindId]);

  function applyTyped(p: ParsedEvent, found: ItemRef[]) {
    const before = auto.current;
    const empty = attributesDraft(kind.fields, {});
    const filled = attributesDraft(kind.fields, p.data);
    const data: AttributeDraft = Object.fromEntries(Object.keys(p.data).map((k) => [k, filled[k]]));
    const sig = (l: LineDraft) => JSON.stringify({ ...l, key: "" });
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    // Kom je van een lijst (Aankoop vanuit Wijnen) en noemt je tekst geen item dat erbij komt, dan is de rest van je
    // tekst iets nieuws in die lijst ("Meursault 2019 32 euro"), niet de omschrijving.
    const loose = newIn && adds && p.name && !p.lines.some((l) => l.item.group === adds) ? niceName(p.name) : "";
    const next = {
      name: loose ? "" : p.name,
      amount: p.amount !== null ? centsToInput(p.amount) : "",
      day: p.day ?? now.slice(0, 10),
      time: p.time ?? startTime,
    };
    setName((cur) => (cur === before.name ? next.name : cur));
    setAmount((cur) => (cur === before.amount ? next.amount : cur));
    setDay((cur) => (cur === before.day ? next.day : cur));
    setTime((cur) => (cur === before.time ? next.time : cur));
    setDraft((cur) => {
      const out = { ...cur };
      for (const f of kind.fields) if (same(cur[f.key], before.data[f.key] ?? empty[f.key])) out[f.key] = data[f.key] ?? empty[f.key];
      return out;
    });
    const made = p.lines.map((l) => {
      const ref = found.find((t) => t.id === l.item.id)!;
      return {
        ...emptyLine({ key: l.item.group ?? main, role: l.item.role }, ref),
        amount: l.amount !== null ? String(l.amount).replace(".", ",") : "",
        unit: l.unit ?? ref.unit ?? "",
        price: l.price !== null ? centsToInput(l.price) : "",
      };
    });
    if (loose && addsG) made.push({ ...emptyLine(addsG), text: loose, newIn });
    setLines((cur) => {
      // Wat de tekst vroeger maakte en niet aangepast is, gaat weg; een lege lijn ook.
      const kept = cur.filter((l) => (before.lines.has(l.key) ? before.lines.get(l.key) !== sig(l) : Boolean(l.item || l.text.trim() || l.amount || l.price)));
      const fresh = made.filter((m) => !kept.some((k) => k.item?.id === m.item?.id));
      const all = [...kept, ...fresh];
      return all.length ? all : startLines(kind, main);
    });
    auto.current = {
      ...next,
      data,
      lines: new Map(made.map((l) => [l.key, sig(l)])),
    };
  }

  const shareWith = (people ?? []).filter((p) => shares.people.includes(p.id));
  const money = kind.parts.money;
  const eats = formEats(kind);

  async function readPhoto(file: File) {
    setReading(true);
    setProblem(undefined);
    try {
      const form = new FormData();
      form.set("image", await prepareUpload(file));
      const read = await api.post<ReceiptRead | FormRead>(`/forms/${kind.id}/read-photo`, form);
      setPending(null);
      clearShared();
      if (read.kind === "form") {
        const data = Object.fromEntries(Object.entries(read.data).filter(([, v]) => v !== null && v !== undefined));
        if (read.message && !read.name && read.amount === null && !Object.keys(data).length) return toast(read.message, "alert");
        if (read.name) setName(read.name);
        if (read.date) setDay(read.date);
        if (read.amount !== null) setAmount(centsToInput(read.amount));
        setDraft((cur) => ({ ...cur, ...attributesDraft(kind.fields.filter((f) => data[f.key] !== undefined), data as Attributes) }));
        setSource(read.estimate ? "Geschat met AI" : "Gelezen met AI");
        return;
      }
      if (read.message && !read.lines.length) return toast(read.message, "alert");
      chosenKind.current = true;
      if (read.date) setDay(read.date);
      if (read.total !== null) setAmount(centsToInput(read.total));
      if (!name.trim() && read.store_text && !read.store) setName(read.store_text);
      const made: LineDraft[] = read.lines.map((l) => ({
        ...emptyLine(addsG ?? mainG, l.item),
        text: l.item ? "" : niceName(l.name),
        newIn: l.item ? "" : defaultNew,
        amount: String(l.amount).replace(".", ","),
        unit: l.unit ?? "",
        price: l.price !== null ? centsToInput(l.price) : "",
        ticket: l.name,
      }));
      // Het formulier heeft geen groep voor de winkel: de naam als omschrijving.
      const store = !storeG ? [] : read.store ? [emptyLine(storeG, read.store)] : read.store_text ? [{ ...emptyLine(storeG), text: read.store_text }] : [];
      setLines((cur) => [...cur.filter((l) => l.item || l.text.trim()), ...store, ...made]);
      setSource(`Kasticket gelezen met AI: ${read.lines.length} ${read.lines.length === 1 ? "lijn" : "lijnen"}`);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setReading(false);
    }
  }

  /**
   * Een gekozen item: de velden waarmee het formulier zijn kolommen zet, beginnen met wat het item nu heeft (enkel als
   * ze nog leeg zijn en van dezelfde soort).
   */
  async function pickItem(item: ItemRef, group: LineGroup) {
    const wanted = kind.does.filter((h) => h.op === "zet" && h.value.from === "field" && h.rows.from === "lines" && h.rows.group === group.key && h.list === item.list_id);
    if (!wanted.length) return;
    const got = await api.get<{ item: { data: Attributes }; list: { fields: FieldDef[] } }>(`/items/${item.id}`).catch(() => null);
    if (!got) return;
    const text = (t: FieldDef["type"]) => FIELD_TYPES[t].group === "text";
    const empty = attributesDraft(kind.fields, {});
    setDraft((cur) => {
      const out = { ...cur };
      for (const h of wanted) {
        const key = h.value.from === "field" ? h.value.key : "";
        const def = kind.fields.find((f) => f.key === key);
        const col = got.list.fields.find((f) => f.key === h.field);
        const v = got.item.data[h.field];
        if (!def || !col || v === undefined || v === null || JSON.stringify(cur[key]) !== JSON.stringify(empty[key])) continue;
        if (col.type !== def.type && !(text(col.type) && text(def.type))) continue;
        out[key] = attributesDraft([def], { [key]: v })[key];
      }
      return out;
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const built = buildAttributes(kind.fields, draft);
    if ("error" in built) return setProblem(built.error);
    const builtLines = [];
    for (const l of lines) {
      const b = buildLine(l);
      if (b && "error" in b) return setProblem(b.error as string);
      if (b) builtLines.push(b);
    }
    builtLines.push(...namedLines(kind, lines.filter((l) => l.item || l.text.trim()).map((l) => l.group), built.data));
    const cents = amount.trim() ? parseEuro(amount) : null;
    if (cents !== null && Number.isNaN(cents)) return setProblem("Het bedrag klopt niet");
    const split = buildShares(shares);
    if (split === undefined) return setProblem("De verdeling klopt nog niet (samen 100%)");
    // Zonder bedrag maar met prijzen per lijn: het bedrag is hun som.
    const priced = builtLines.reduce((s, l) => s + (typeof l.price === "number" ? l.price : 0), 0);
    const at = time ? `${day}T${time}` : day;
    const body = {
      kind: kind.id,
      name: name.trim(),
      status,
      at,
      end_at: kind.parts.duration && time && endTime ? `${day}T${endTime}` : null,
      amount: cents ?? (money && priced ? priced : null),
      paid_by: money ? paidBy || null : null,
      to_person: kind.parts.to ? toPerson || null : null,
      split: split.length ? split : null,
      data: built.data,
      lines: builtLines,
      repeat: repeat ? { every: EVERY.find((x) => x.value === repeat)!.every } : null,
    };
    setBusy(true);
    setProblem(undefined);
    try {
      let id = event?.id;
      let extra = "";
      if (event) await api.put(`/events/${event.id}`, body);
      else {
        const saved = await api.post<{
          id: string;
          made: { name: string }[];
          ticked: { name: string }[];
        }>(`/forms/${kind.id}/events`, body);
        id = saved.id;
        if (saved.made.length) extra += `, nieuw: ${saved.made.map((m) => m.name).join(", ")}`;
        if (saved.ticked.length) extra += `, afgevinkt: ${saved.ticked.length === 1 ? "1 boodschap" : `${saved.ticked.length} boodschappen`}`;
      }
      // De naam op het ticket bij het gekozen item onthouden (de volgende keer koppelt het vanzelf); een nieuw item krijgt
      // hem bij het maken (`alias` in `buildLine`).
      for (const l of lines) if (l.item && renamed(l)) api.post(`/items/${l.item.id}/alias`, { name: l.ticket }).catch(() => {});
      if (photo && id) {
        const form = new FormData();
        form.set("file", await prepareUpload(photo));
        await api.put(`/events/${id}/photo`, form).catch((err: Error) => toast(err.message, "alert"));
      }
      toast(`${kind.name} ${!event && status === "gepland" ? "gepland" : "bewaard"}${extra}`);
      // Terug naar de lijst waar je vandaan kwam, anders naar het formulier.
      const tab = `?tab=${status === "gepland" ? "gepland" : "logboek"}`;
      navigate(event ? `/gebeurtenissen/${event.id}` : homeList ? `/lijsten/${homeList.id}${tab}` : `/formulieren/${kind.id}${tab}`, { replace: true });
    } catch (err) {
      if (!event && isOffline(err)) {
        await enqueue("event", kind.id, name.trim() || kind.name, body, photo);
        toast(`${kind.name} wacht op internet`);
        navigate(homeList ? `/lijsten/${homeList.id}` : `/formulieren/${kind.id}`, { replace: true });
        return;
      }
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  }


  return (
    <form className="form page" onSubmit={save}>
      <PageHead title={event ? `${kind.name} bewerken` : status === "gepland" ? "Plannen" : "Loggen"} back={{ to: -1, label: homeList?.name ?? kind.name }} />
      <section className="card form-section">
        {!event && <input value={typed} maxLength={300} autoFocus={!typed} aria-label="Typ wat je weet" placeholder="Typ wat je weet…" onChange={(e) => setTyped(e.target.value)} />}
        {!event?.photo_version && (
          <div className="field">
            <div className="btn-row photo-row">
              {pending && reads ? (
                <button type="button" className="btn btn-primary btn-sm" disabled={reading} onClick={() => readPhoto(pending)}>
                  <Icon name="camera" size={15} /> {reading ? "Lezen…" : "Foto lezen"} <AiMark />
                </button>
              ) : (
                <PhotoButton
                  read={reads ? true : null}
                  busy={reading}
                  onPhoto={(file, read) => {
                    setPhoto(file);
                    setSource(null);
                    if (read) readPhoto(file);
                  }}
                >
                  {reading ? "Lezen…" : photo ? "Andere foto" : "Foto"}
                </PhotoButton>
              )}
              {photo && (
                <>
                  <span className="photo-name">{photo.name}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setPhoto(null);
                      setPending(null);
                    }}
                  >
                    Weghalen
                  </button>
                </>
              )}
            </div>
            {source && <span className="muted">{source}</span>}
          </div>
        )}
        <FormPicker
          kinds={kinds}
          listId={home}
          value={kindId}
          onChange={(k) => {
            chosenKind.current = true;
            setKindId(k.id);
          }}
        />
        <label className="field">
          <span className="label">Omschrijving</span>
          <input value={name} maxLength={200} placeholder={kind.name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="label">
              Wanneer
              <RequiredMark />
            </span>
            <input type="date" required value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">{kind.parts.duration ? "Van" : "Uur"}</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          {kind.parts.duration && (
            <label className="field">
              <span className="label">Tot</span>
              <input type="time" value={endTime} disabled={!time} onChange={(e) => setEndTime(e.target.value)} />
            </label>
          )}
        </div>
        <Switch
          label="Gepland"
          checked={status === "gepland"}
          onChange={(on) => {
            statusChosen.current = true;
            setStatus(on ? "gepland" : event?.status === "afgevinkt" ? "afgevinkt" : "gebeurd");
          }}
        />
      </section>

      {(money || eats) && (
        <section className="card form-section">
          {money && (
            <div className="field-row">
              <label className="field">
                <span className="label">Bedrag</span>
                <input inputMode="decimal" placeholder="€" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">{kind.parts.to ? "Van" : "Betaald door"}</span>
                <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                  <option value="">—</option>
                  {(people ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === person.id ? `${p.name} (jij)` : p.name}
                    </option>
                  ))}
                </select>
              </label>
              {kind.parts.to && (
                <label className="field">
                  <span className="label">Naar</span>
                  <select value={toPerson} onChange={(e) => setToPerson(e.target.value)}>
                    <option value="">—</option>
                    {(people ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          {!kind.parts.to && (
            <div className="field">
              <span className="label">{money ? "Gedeeld met" : "Wie at of gebruikte"}</span>
              <SharesField
                people={people ?? []}
                meId={person.id}
                value={shares}
                onChange={(next) => {
                  sharesChosen.current = true;
                  setShares(next);
                }}
                total={amount.trim() ? parseEuro(amount) : null} />
            </div>
          )}
        </section>
      )}

      {(kind.parts.groups.length > 0 || lines.length > 0) && (
        <section className="card form-section">
          <LinesEditor kind={kind} lines={lines} onChange={setLines} people={shareWith} targets={targets} defaultNew={newIn} onPick={pickItem} />
        </section>
      )}

      {kind.fields.length > 0 && (
        <section className="card form-section">
          <FieldInputs defs={kind.fields} value={draft} onChange={(next) => setDraft(next)} access={access} people={people ?? []} meId={person.id} />
        </section>
      )}

      <section className="card form-section">
        <label className="field">
          <span className="label">Herhalen</span>
          <select value={repeat} onChange={(e) => setRepeat(e.target.value)}>
            {EVERY.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {problem && <p className="error">{problem}</p>}
      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        Opslaan
      </SubmitButton>
    </form>
  );
}
