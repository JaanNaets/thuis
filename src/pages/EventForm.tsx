import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import type { Interval } from "../../shared/fields";
import { BASES, brusselsNow, canEdit, type EventView, type KindInfo, type ListDetail, type Status, type ThingRef } from "../../shared/model";
import type { Person } from "../../shared/types";
import { api, useApi } from "../api";
import { SubmitButton, Switch } from "../components/Controls";
import { attributesDraft, buildAttributes, buildShares, FieldInputs, sharesDraft, SharesField, type AttributeDraft, type SharesDraft } from "../components/Fields";
import { Icon } from "../components/Icon";
import { buildLine, emptyLine, lineDraft, LinesEditor, type LineDraft } from "../components/Lines";
import { PageHead } from "../components/Page";
import { useToast } from "../components/Toast";
import { centsToInput, parseEuro } from "../format";
import { prepareUpload } from "../image";
import { enqueue, isOffline } from "../outbox";
import { useNavigate } from "../router";
import { useSession } from "../session";
import { allEdit } from "./ThingForm";
import type { EventPage } from "../components/Log";

type EventDetail = EventPage & { event: EventView; can_edit: boolean };

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
  const { person, lists } = useSession();
  const [params] = useSearchParams();
  const { data: people } = useApi<Person[]>("/me/people");
  const thingParam = params.get("ding");
  const { data: preset } = useApi<{ things: ThingRef[] }>(thingParam && !event ? `/things?ids=${thingParam}` : null);

  // De soorten: die van deze lijst eerst, dan de basissoorten, dan die van andere lijsten.
  const own = detail.kinds.filter((k) => k.list_id === list.id);
  const bases = detail.kinds.filter((k) => !k.list_id);
  const others = detail.kinds.filter((k) => k.list_id && k.list_id !== list.id);
  const wantedKind = params.get("soort");
  const [kindId, setKindId] = useState<string>(
    () => event?.kind ?? (wantedKind && detail.kinds.some((k) => k.id === wantedKind) ? wantedKind : (own[0]?.id ?? (list.stock ? "aankoop" : "activiteit"))),
  );
  const kind: KindInfo = detail.kinds.find((k) => k.id === kindId) ?? existing?.kinds.find((k) => k.id === kindId) ?? bases[0];
  const base = BASES[kind.base];

  const now = brusselsNow();
  const [name, setName] = useState(event?.name ?? params.get("tekst") ?? "");
  const [day, setDay] = useState((event?.at ?? now).slice(0, 10));
  const [time, setTime] = useState(event ? event.at.slice(11, 16) : kind.base === "activiteit" ? now.slice(11, 16) : "");
  const [endTime, setEndTime] = useState(event?.end_at?.slice(11, 16) ?? "");
  const [status, setStatus] = useState<Status>(event?.status ?? (params.get("gepland") ? "gepland" : "gebeurd"));
  const [amount, setAmount] = useState(centsToInput(event?.amount ?? null));
  const [paidBy, setPaidBy] = useState(event ? (event.paid_by ?? "") : person.id);
  const [toPerson, setToPerson] = useState(event?.to_person ?? "");
  const [shares, setShares] = useState<SharesDraft>(() => sharesDraft(event?.split ?? undefined));
  const [draft, setDraft] = useState<AttributeDraft>(() => attributesDraft(kind.fields, event?.data ?? {}));
  const [lines, setLines] = useState<LineDraft[]>(() =>
    event ? event.lines.map((l) => lineDraft(l, existing?.things.find((t) => t.id === l.thing_id))) : [emptyLine(base.line)],
  );
  const [repeat, setRepeat] = useState(() => {
    const r = event?.repeat?.every;
    return r ? (EVERY.find((e) => e.every?.n === r.n && e.every.unit === r.unit)?.value ?? "") : "";
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const access = useMemo(() => allEdit(kind.fields), [kind.fields]);
  const photoRef = useRef<HTMLInputElement>(null);

  // Een ding uit het adres (Loggen vanaf een ding): meteen als eerste lijn.
  useEffect(() => {
    const t = preset?.things[0];
    if (t) setLines((ls) => (ls.length === 1 && !ls[0].thing && !ls[0].text ? [{ ...emptyLine(base.line, t), unit: t.unit ?? "" }] : ls));
  }, [preset]);
  // Een andere soort: haar (lege) velden, en lege lijnen krijgen de rol van de soort.
  const firstKind = useRef(kindId);
  useEffect(() => {
    if (firstKind.current === kindId) return;
    firstKind.current = "";
    setDraft(attributesDraft(kind.fields, {}));
    setLines((ls) => ls.map((l) => (!l.thing && !l.text ? { ...l, role: base.line } : l)));
  }, [kindId]);

  if (!canEdit(role)) return <p className="page muted">Je mag in deze lijst enkel kijken.</p>;
  const shareWith = (people ?? []).filter((p) => shares.people.includes(p.id));
  const targets = lists.filter((l) => l.one && (l.role === "lid" || l.role === "beheerder") && !l.archived);
  const money = base.money;

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
        const saved = await api.post<{ id: string; made: { name: string }[]; ticked: { name: string }[] }>(`/lists/${list.id}/events`, body);
        id = saved.id;
        if (saved.made.length) extra += `, nieuw: ${saved.made.map((m) => m.name).join(", ")}`;
        if (saved.ticked.length) extra += `, afgevinkt: ${saved.ticked.length === 1 ? "1 boodschap" : `${saved.ticked.length} boodschappen`}`;
      }
      if (photo && id) {
        const form = new FormData();
        form.set("file", await prepareUpload(photo));
        await api.put(`/events/${id}/photo`, form).catch((err: Error) => toast(err.message, "alert"));
      }
      toast(`${kind.name} bewaard${extra}`);
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

  const pill = (k: KindInfo) => (
    <button key={k.id} type="button" className="filter" aria-pressed={k.id === kindId} onClick={() => setKindId(k.id)}>
      {k.name}
    </button>
  );

  return (
    <form className="form page" onSubmit={save}>
      <PageHead title={event ? `${kind.name} bewerken` : status === "gepland" ? "Plannen" : "Loggen"} back={{ to: -1, label: list.name }} />
      <section className="card form-section">
        <div className="field">
          <span className="label">Soort</span>
          <div className="filters" role="group" aria-label="Soort">
            {[...own, ...bases].map(pill)}
          </div>
          {others.length > 0 && (
            <select aria-label="Andere soort" value={others.some((k) => k.id === kindId) ? kindId : ""} onChange={(e) => e.target.value && setKindId(e.target.value)}>
              <option value="">Andere soort…</option>
              {others.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <label className="field">
          <span className="label">Omschrijving</span>
          <input value={name} maxLength={200} placeholder={kind.name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="label">Wanneer</span>
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
        <Switch label="Gepland" checked={status === "gepland"} onChange={(on) => setStatus(on ? "gepland" : event?.status === "afgevinkt" ? "afgevinkt" : "gebeurd")} />
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
              <SharesField people={people ?? []} meId={person.id} value={shares} onChange={setShares} total={amount.trim() ? parseEuro(amount) : null} />
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
        {!event?.photo_version && (
          <div className="field">
            <span className="label">Foto</span>
            <div className="btn-row">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => photoRef.current?.click()}>
                <Icon name="camera" size={15} /> {photo ? photo.name : "Foto toevoegen"}
              </button>
              {photo && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhoto(null)}>
                  Weghalen
                </button>
              )}
            </div>
            <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => (setPhoto(e.target.files?.[0] ?? null), (e.target.value = ""))} />
          </div>
        )}
      </section>

      {problem && <p className="error">{problem}</p>}
      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        Opslaan
      </SubmitButton>
    </form>
  );
}
