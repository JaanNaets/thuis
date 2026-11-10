import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import type { Attributes, Interval } from "../../shared/fields";
import { defaultSharers } from "../../shared/ledger";
import { BASES, brusselsNow, canEdit, startsPlanned, type EventView, type KindInfo, type LineRole, type ListDetail, type Status, type ThingRef } from "../../shared/model";
import { fold, readEvent, type ParsedEvent } from "../../shared/parse";
import { readsPhoto } from "../../shared/photoread";
import { hasPrice } from "../../shared/targets";
import { niceName } from "../../shared/receipt";
import type { Person } from "../../shared/types";
import { api, useApi } from "../api";
import { RequiredMark, SubmitButton, Switch } from "../components/Controls";
import { attributesDraft, buildAttributes, buildShares, FieldInputs, sharesDraft, SharesField, type AttributeDraft, type SharesDraft } from "../components/Fields";
import { AiMark } from "../components/Fields";
import { FormPicker } from "../components/FormPicker";
import { Icon } from "../components/Icon";
import { buildLine, emptyLine, lineDraft, LinesEditor, type LineDraft } from "../components/Lines";
import { PageHead } from "../components/Page";
import { PhotoButton } from "../components/PhotoPicker";
import { useToast } from "../components/Toast";
import { centsToInput, parseEuro } from "../format";
import { prepareUpload } from "../image";
import { enqueue, isOffline } from "../outbox";
import { useNavigate } from "../router";
import { clearShared, sharedFile } from "../shared-file";
import { useSession } from "../session";
import { allEdit } from "./ThingForm";
import type { EventPage } from "../components/Log";

type EventDetail = EventPage & { event: EventView; can_edit: boolean };

/** Wat een foto opleverde (POST /lists/:id/events/read-photo): een kasticket bij een aankoop, anders de velden. */
type ReceiptRead = {
  kind: "receipt";
  store: ThingRef | null;
  store_text: string | null;
  date: string | null;
  total: number | null;
  lines: {
    name: string;
    thing: ThingRef | null;
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
 * Loggen in een lijst (`/lijsten/:id/loggen`, met `?soort=`, `?ding=`, `?tekst=` of `?gepland=1`), of een gebeurtenis
 * bewerken (`/gebeurtenissen/:eventId/bewerken`). Zie STIJLBOEK.md → Formulier en Lijnen.
 */
export function EventFormPage() {
  const { id, eventId } = useParams();
  const { data: existing, error: loadError } = useApi<EventDetail>(eventId ? `/events/${eventId}` : null);
  const listId = id ?? existing?.event.list_id ?? null;
  const { data: detail, error } = useApi<ListDetail>(listId ? `/lists/${listId}` : null);
  if (error || loadError) return <p className="error page">{error ?? loadError}</p>;
  if (!detail || (eventId && !existing)) return <p className="page muted">Laden…</p>;
  return <EventForm key={eventId ?? listId} detail={detail} existing={existing ?? null} />;
}

function EventForm({ detail, existing }: { detail: ListDetail; existing: EventDetail | null }) {
  const { list, role } = detail;
  const event = existing?.event ?? null;
  const toast = useToast();
  const navigate = useNavigate();
  const { person, lists, ai } = useSession();
  const [params] = useSearchParams();
  const { data: people } = useApi<Person[]>("/me/people");
  const thingParam = params.get("ding");
  const { data: preset } = useApi<{ things: ThingRef[] }>(thingParam && !event ? `/things?ids=${thingParam}` : null);

  // De soorten: die van deze lijst eerst, dan de basissoorten, dan die van andere lijsten.
  const own = detail.kinds.filter((k) => k.list_id === list.id);
  const bases = detail.kinds.filter((k) => !k.list_id);
  const wantedKind = params.get("soort");
  const [kindId, setKindId] = useState<string>(
    () => event?.kind ?? (wantedKind && detail.kinds.some((k) => k.id === wantedKind) ? wantedKind : (own[0]?.id ?? (list.stock ? "aankoop" : "activiteit"))),
  );
  const chosenKind = useRef(Boolean(event || wantedKind));
  const kind: KindInfo = detail.kinds.find((k) => k.id === kindId) ?? existing?.kinds.find((k) => k.id === kindId) ?? bases[0];
  const base = BASES[kind.base];

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
  const [time, setTime] = useState(event ? event.at.slice(11, 16) : kind.base === "activiteit" ? now.slice(11, 16) : "");
  const [endTime, setEndTime] = useState(event?.end_at?.slice(11, 16) ?? "");
  // Gepland als je erom vroeg (`?gepland=1`) of als het formulier gepland begint; tot je de schakelaar zelf zet.
  const askedPlanned = Boolean(params.get("gepland"));
  const [status, setStatus] = useState<Status>(event?.status ?? (startsPlanned(kind, askedPlanned) ? "gepland" : "gebeurd"));
  const statusChosen = useRef(Boolean(event));
  const [amount, setAmount] = useState(centsToInput(event?.amount ?? null));
  const [paidBy, setPaidBy] = useState(event ? (event.paid_by ?? "") : person.id);
  const [toPerson, setToPerson] = useState(event?.to_person ?? "");
  // Een nieuwe uitgave in een gedeelde lijst: gelijk over wie er logt (shared/ledger.ts), tot je de verdeling zelf kiest.
  const sharers = detail.people.filter((p) => p.direct !== "geen").map((p) => ({ id: p.person.id, role: p.role }));
  const defaultShares = (b: typeof kind.base): SharesDraft => {
    const ids = defaultSharers(b, sharers);
    return ids.length ? { mode: "equal", people: ids, values: {} } : sharesDraft(undefined);
  };
  const [shares, setShares] = useState<SharesDraft>(() => (event ? sharesDraft(event.split ?? undefined) : defaultShares(kind.base)));
  const sharesChosen = useRef(Boolean(event));
  useEffect(() => {
    if (!sharesChosen.current) setShares(defaultShares(kind.base));
    // Enkel bij een andere soort; de mensen van de lijst veranderen niet terwijl je invult.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind.base]);
  const [draft, setDraft] = useState<AttributeDraft>(() => attributesDraft(kind.fields, event?.data ?? (Object.fromEntries(Object.entries(prefill).filter(([k]) => k !== "name")) as Attributes)));
  const [lines, setLines] = useState<LineDraft[]>(() =>
    event
      ? event.lines.map((l) =>
          lineDraft(
            l,
            existing?.things.find((t) => t.id === l.thing_id),
          ),
        )
      : [emptyLine(base.line)],
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
  const ticketNames = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const access = useMemo(() => allEdit(kind.fields), [kind.fields]);
  // Leest dit formulier een foto (Instellen van de lijst, en de AI staat voor jou aan)?
  const reads = Boolean(ai && !event && readsPhoto(list.read_photo, kind.id, kind));

  // Een ding uit het adres (Loggen vanaf een ding): meteen als eerste lijn.
  useEffect(() => {
    const t = preset?.things[0];
    if (t) setLines((ls) => (ls.length === 1 && !ls[0].thing && !ls[0].text ? [{ ...emptyLine(base.line, t), unit: t.unit ?? "" }] : ls));
  }, [preset]);
  // Een gedeelde foto (Android: delen met Heystack, of de foto bij de +): ze komt bij wat je logt. Met `lezen=1` koos je
  // al om ze te laten lezen; anders wacht ze op een tik op Foto lezen. Een kasticket is een aankoop.
  const sharedTaken = useRef(false);
  useEffect(() => {
    const receipt = params.get("kasticket") === "gedeeld";
    // Eén keer (ook als React het effect twee keer draait): anders leest de AI dezelfde foto twee keer.
    if (sharedTaken.current || event || (!receipt && params.get("foto") !== "gedeeld")) return;
    sharedTaken.current = true;
    // Een kasticket: het eigen aankoopformulier van de lijst, anders de aankoop zelf.
    const buy = own.find((k) => k.base === "aankoop")?.id ?? (detail.kinds.some((k) => k.id === "aankoop") ? "aankoop" : null);
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
  // Een andere soort: haar (lege) velden, en lege lijnen krijgen de rol van de soort.
  const firstKind = useRef(kindId);
  useEffect(() => {
    if (firstKind.current === kindId) return;
    firstKind.current = "";
    setDraft(attributesDraft(kind.fields, {}));
    setLines((ls) => ls.map((l) => (!l.thing && !l.text ? { ...l, role: base.line } : l)));
    if (!statusChosen.current) setStatus(startsPlanned(kind, askedPlanned) ? "gepland" : "gebeurd");
  }, [kindId]);

  // Wat je typt ("pasta 300 g", "tankbeurt 84,50 52 liter"), live in de velden (shared/parse.ts). Enkel wat de tekst
  // er zelf zette, verandert mee; wat je daarna zelf aanpaste, blijft staan (en wissen zet terug wat er stond).
  const startTime = kind.base === "activiteit" ? now.slice(11, 16) : "";
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
    // Begint de tekst met een soort ("gegeten pasta"), dan die soort.
    const lead = [...own, ...bases].find((k) => fold(text) === fold(k.name) || fold(text).startsWith(`${fold(k.name)} `));
    if (lead) {
      text = text.slice(lead.name.length).trim();
      if (lead.id !== kindId) {
        auto.current.data = {};
        setKindId(lead.id);
        return;
      }
    } else if (!chosenKind.current && !money && hasPrice(text) && detail.kinds.some((k) => k.id === "aankoop")) {
      // Een prijs zonder gekozen soort: een aankoop.
      setKindId("aankoop");
      return;
    }
    let stale = false;
    const timer = window.setTimeout(
      async () => {
        const found = text
          ? (
              await api
                .get<{
                  things: ThingRef[];
                }>(`/things?in=${encodeURIComponent(text)}&limit=10`)
                .catch(() => ({ things: [] as ThingRef[] }))
            ).things
          : [];
        if (stale) return;
        // Uit een voorraad: wat de soort doet (erbij, eraf, een telling); anders wat het ding meestal is (Colruyt: bij).
        const roleOf = (t: ThingRef): LineRole => (t.stock ? base.line : (t.usual ?? (base.line === "in" || base.line === "uit" ? "voor" : base.line)));
        const parsed = readEvent(text, {
          today: now.slice(0, 10),
          money,
          fields: kind.fields,
          things: found.map((t) => ({
            id: t.id,
            name: t.name,
            unit: t.unit,
            role: roleOf(t),
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

  function applyTyped(p: ParsedEvent, found: ThingRef[]) {
    const before = auto.current;
    const empty = attributesDraft(kind.fields, {});
    const filled = attributesDraft(kind.fields, p.data);
    const data: AttributeDraft = Object.fromEntries(Object.keys(p.data).map((k) => [k, filled[k]]));
    const sig = (l: LineDraft) => JSON.stringify({ ...l, key: "" });
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const next = {
      name: p.name,
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
      const ref = found.find((t) => t.id === l.thing.id)!;
      return {
        ...emptyLine(l.thing.role, ref),
        amount: l.amount !== null ? String(l.amount).replace(".", ",") : "",
        unit: l.unit ?? ref.unit ?? "",
        price: l.price !== null ? centsToInput(l.price) : "",
      };
    });
    setLines((cur) => {
      // Wat de tekst vroeger maakte en niet aangepast is, gaat weg; een lege lijn ook.
      const kept = cur.filter((l) => (before.lines.has(l.key) ? before.lines.get(l.key) !== sig(l) : Boolean(l.thing || l.text.trim() || l.amount || l.price)));
      const fresh = made.filter((m) => !kept.some((k) => k.thing?.id === m.thing?.id));
      const all = [...kept, ...fresh];
      return all.length ? all : [emptyLine(base.line)];
    });
    auto.current = {
      ...next,
      data,
      lines: new Map(made.map((l) => [l.key, sig(l)])),
    };
  }

  if (!canEdit(role)) return <p className="page muted">Je mag in deze lijst enkel kijken.</p>;
  const shareWith = (people ?? []).filter((p) => shares.people.includes(p.id));
  const targets = lists.filter((l) => l.one && (l.role === "lid" || l.role === "beheerder") && !l.archived);
  const money = base.money;

  async function readPhoto(file: File) {
    setReading(true);
    setProblem(undefined);
    try {
      const form = new FormData();
      form.set("image", await prepareUpload(file));
      form.set("kind", kind.id);
      const read = await api.post<ReceiptRead | FormRead>(`/lists/${list.id}/events/read-photo`, form);
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
      ticketNames.current = new Map();
      const made: LineDraft[] = read.lines.map((l) => {
        const line = {
          ...emptyLine("in", l.thing),
          text: l.thing ? "" : niceName(l.name),
          newIn: !l.thing && list.stock ? list.id : "",
          amount: String(l.amount).replace(".", ","),
          unit: l.unit ?? "",
          price: l.price !== null ? centsToInput(l.price) : "",
        };
        ticketNames.current.set(line.key, l.name);
        return line;
      });
      const store = read.store ? [emptyLine("bij", read.store)] : read.store_text ? [{ ...emptyLine("bij"), text: read.store_text }] : [];
      setLines((cur) => [...cur.filter((l) => l.thing || l.text.trim()), ...store, ...made]);
      setSource(`Kasticket gelezen met AI: ${read.lines.length} ${read.lines.length === 1 ? "lijn" : "lijnen"}`);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setReading(false);
    }
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
      end_at: kind.base === "activiteit" && time && endTime ? `${day}T${endTime}` : null,
      amount: cents ?? (money && priced ? priced : null),
      paid_by: money ? paidBy || null : null,
      to_person: kind.base === "overdracht" ? toPerson || null : null,
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
        }>(`/lists/${list.id}/events`, body);
        id = saved.id;
        if (saved.made.length) extra += `, nieuw: ${saved.made.map((m) => m.name).join(", ")}`;
        if (saved.ticked.length) extra += `, afgevinkt: ${saved.ticked.length === 1 ? "1 boodschap" : `${saved.ticked.length} boodschappen`}`;
      }
      // De naam op het ticket bij het gekozen ding onthouden (de volgende keer koppelt het vanzelf).
      for (const l of lines) {
        const ticket = ticketNames.current.get(l.key);
        if (ticket && l.thing && fold(ticket) !== fold(l.thing.name)) api.post(`/things/${l.thing.id}/alias`, { name: ticket }).catch(() => {});
      }
      if (photo && id) {
        const form = new FormData();
        form.set("file", await prepareUpload(photo));
        await api.put(`/events/${id}/photo`, form).catch((err: Error) => toast(err.message, "alert"));
      }
      toast(`${kind.name} ${!event && status === "gepland" ? "gepland" : "bewaard"}${extra}`);
      navigate(event ? `/gebeurtenissen/${event.id}` : `/lijsten/${list.id}?tab=${status === "gepland" ? "gepland" : "logboek"}`, { replace: true });
    } catch (err) {
      if (!event && isOffline(err)) {
        await enqueue("event", list.id, name.trim() || kind.name, body, photo);
        toast(`${kind.name} wacht op internet`);
        navigate(`/lijsten/${list.id}`, { replace: true });
        return;
      }
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  }


  return (
    <form className="form page" onSubmit={save}>
      <PageHead title={event ? `${kind.name} bewerken` : status === "gepland" ? "Plannen" : "Loggen"} back={{ to: -1, label: list.name }} />
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
          kinds={detail.kinds}
          listId={list.id}
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
            <span className="label">{kind.base === "activiteit" ? "Van" : "Uur"}</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          {kind.base === "activiteit" && (
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

      {(money || kind.base === "gebruik") && (
        <section className="card form-section">
          {money && (
            <div className="field-row">
              <label className="field">
                <span className="label">Bedrag</span>
                <input inputMode="decimal" placeholder="€" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">{kind.base === "overdracht" ? "Van" : "Betaald door"}</span>
                <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                  <option value="">—</option>
                  {(people ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === person.id ? `${p.name} (jij)` : p.name}
                    </option>
                  ))}
                </select>
              </label>
              {kind.base === "overdracht" && (
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
          {kind.base !== "overdracht" && (
            <div className="field">
              <span className="label">{kind.base === "gebruik" ? "Wie at of gebruikte" : "Gedeeld met"}</span>
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

      <section className="card form-section">
        <LinesEditor lines={lines} onChange={setLines} money={money} people={shareWith} targets={targets} />
      </section>

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
