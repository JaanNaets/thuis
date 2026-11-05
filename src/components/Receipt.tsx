// Een kasticket per lijn (zie shared/receipt.ts): de AI leest het ticket (✨ op de knoppen), jij kijkt na wat voor
// alle lijnen geldt (datum, winkel, wie betaalde, de verdeling) en elke lijn (het product, hoeveel, de prijs, Gegeten,
// Van mij), en alles komt in één keer in de lijst: elke lijn een item, met het kasticket zelf (en de foto) erbij als
// de lijst er een heeft. Een gekoppelde lijn onthoudt de naam op het ticket bij het product.

import { useEffect, useMemo, useRef, useState } from "react";
import { applyFieldDefaults, type FieldDef } from "../../shared/fields";
import { commonFields, lineData, linesTotal, newProductData, niceName, receiptData, receiptPlan, type ReviewLine } from "../../shared/receipt";
import type { ItemRef, ItemTypeView, ProjectDetail, ReceiptRead } from "../../shared/types";
import { api } from "../api";
import { REFRESH_EVENT } from "../device";
import { centsToInput, formatCents, parseEuro, today } from "../format";
import { prepareForReading, prepareUpload } from "../image";
import { useSession } from "../session";
import { clearShared } from "../shared-file";
import { Alert } from "./Controls";
import { AiMark, attributesDraft, buildAttributes, FieldInputs, type AttributeDraft } from "./Fields";
import { Icon } from "./Icon";
import { ItemPicker } from "./ItemPicker";
import { useToast } from "./Toast";

type Line = ReviewLine & { ticket: string; amountText: string; priceText: string };
type Checked = { id: string; name: string; field: string; list: string };

/**
 * Een bewaard kasticket helemaal terugdraaien: de afgevinkte boodschappen weer open, wat in Eten kwam weg, de lijnen weg
 * (dat draait het bijtellen terug), dan het ticket en de nieuwe producten. Wat niet lukt, blijft staan (en dat zegt de
 * melding).
 */
async function undoReceipt(
  saved: { lines: string[]; spawned: string[]; group: string | null; created: string[]; ticked: Checked[] },
  toast: ReturnType<typeof useToast>,
) {
  let failed = 0;
  const run = async (step: () => Promise<unknown>) => {
    try {
      await step();
    } catch {
      failed++;
    }
  };
  for (const t of saved.ticked) await run(() => api.post(`/items/${t.id}/check`, { field: t.field, value: false }));
  for (const id of [...saved.spawned, ...saved.lines]) await run(() => api.delete(`/items/${id}`));
  for (const id of [...(saved.group ? [saved.group] : []), ...saved.created]) await run(() => api.delete(`/items/${id}`));
  window.dispatchEvent(new Event(REFRESH_EVENT));
  toast(failed ? `Kasticket ongedaan gemaakt, op ${failed} na` : "Kasticket ongedaan gemaakt", failed ? "alert" : "check");
}

/** Of een lijst een kasticket per lijn kan lezen (een bedrag en een product dat telt). */
export const readsReceipts = (type: ItemTypeView) => receiptPlan(type.fields, type.id, () => undefined) !== null;

export function ReceiptToLines({
  project,
  type,
  onDone,
  initial,
}: {
  project: ProjectDetail;
  type: ItemTypeView;
  onDone: () => void;
  /** Een foto die al klaarligt (gedeeld vanuit een andere app): die wacht tot je ze laat lezen. */
  initial?: File | null;
}) {
  const toast = useToast();
  const { person } = useSession();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // De lijsten van dit project en erboven: om het kasticket te herkennen (dat staat niet bij "voor alle lijnen").
  const plan = useMemo(() => receiptPlan(type.fields, type.id, (id) => project.types.find((t) => t.id === id)?.fields)!, [type, project.types]);
  const people = project.members.map((m) => m.person);
  const editable = (f: FieldDef) => type.field_access[f.key] === "edit";
  const [read, setRead] = useState<ReceiptRead>();
  const common = useMemo(() => commonFields(type.fields, plan).filter((f) => editable(f) && f.key !== read?.receipt?.key), [type, plan, read]);
  const productDef = type.fields.find((f) => f.key === plan.product.key)!;
  const unitDef = plan.unit ? type.fields.find((f) => f.key === plan.unit) : undefined;
  const [photo, setPhoto] = useState<File | null>(null);
  const [head, setHead] = useState<AttributeDraft>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [status, setStatus] = useState<{ tone: "busy" | "ok" | "none"; text: string }>();
  const [busy, setBusy] = useState(false);
  // Een gedeelde foto: nooit vanzelf naar de AI.
  const [pending, setPending] = useState<File | null>(null);
  const pendingUrl = useMemo(() => (pending ? URL.createObjectURL(pending) : null), [pending]);
  useEffect(() => () => void (pendingUrl && URL.revokeObjectURL(pendingUrl)), [pendingUrl]);
  useEffect(() => {
    if (!initial) return;
    setPending(initial);
    clearShared();
  }, [initial]);

  async function scan(file: File | undefined) {
    if (!file) return;
    setRead(undefined);
    setLines([]);
    setOpen(null);
    setStatus({ tone: "busy", text: "Kasticket lezen met AI" });
    try {
      const body = new FormData();
      body.set("image", await prepareForReading(file));
      body.set("type_id", type.id);
      const found = await api.post<ReceiptRead>(`/projects/${project.project.id}/items/scan-receipt`, body);
      setPhoto(file);
      setRead(found);
      // Voor alle lijnen: wat de velden zelf invullen (jij betaalde, de gewone verdeling), met de datum en de winkel
      // van het ticket.
      const storeDef = plan.store ? type.fields.find((f) => f.key === plan.store!.key) : undefined;
      const store = found.store ? (found.store.id ?? (storeDef?.free ? { text: found.store.name } : undefined)) : undefined;
      const start = applyFieldDefaults(
        type.fields,
        {
          ...(plan.date ? { [plan.date]: found.date ?? today() } : {}),
          ...(plan.store && store ? { [plan.store.key]: store } : {}),
        },
        people.map((p) => p.id),
        person.id,
        true,
      );
      setHead(attributesDraft(commonFields(type.fields, plan).filter((f) => editable(f) && f.key !== found.receipt?.key), start));
      setLines(
        found.lines.map((l) => ({
          on: true,
          ticket: l.name,
          name: niceName(l.name),
          product: l.product,
          // Nog niet gekend: een nieuw product in de eerste lijst waarin je mag toevoegen (Voorraad).
          newIn: l.product ? null : (found.targets[0]?.type_id ?? null),
          ...(l.remember ? { remember: l.remember } : {}),
          amount: l.amount,
          unit: unitDef ? l.unit : null,
          price: l.price,
          eaten: false,
          mine: false,
          amountText: String(l.amount).replace(".", ","),
          priceText: centsToInput(l.price),
        })),
      );
      setStatus(found.message ? { tone: "none", text: found.message } : { tone: "ok", text: "Gelezen met AI. Kijk de lijnen na." });
    } catch (err) {
      setStatus({ tone: "none", text: (err as Error).message });
    }
  }

  const set = (i: number, patch: Partial<Line>) => setLines((list) => list.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const targets = read?.targets ?? [];
  // Twee lijsten met dezelfde naam (Wijnen hier en in de Wijnkelder): met het project erbij.
  const targetName = (id: string | null) => {
    const t = targets.find((x) => x.type_id === id);
    if (!t) return "";
    return targets.filter((x) => x.plural === t.plural).length > 1 ? `${t.plural} · ${t.project_name}` : t.plural;
  };
  const chosen = lines.filter((l) => l.on);
  const total = linesTotal(lines);
  const ticketTotal = read?.total ?? null;

  async function save() {
    const built = buildAttributes(common, head);
    if ("error" in built) return toast(built.error, "alert");
    if (!chosen.length) return;
    setBusy(true);
    try {
      const items = chosen.map((l) => {
        const target = !l.product && l.newIn ? targets.find((t) => t.type_id === l.newIn) : undefined;
        return {
          name: l.product?.name ?? l.name,
          data: lineData(plan, type.fields, built.data, l, person.id),
          // Een nieuw product: het ontstaat bij het bewaren, en de lijn verwijst ernaar (zie /items/batch).
          ...(target ? { new_ref: { field: plan.product.key, type_id: target.type_id, name: l.name, data: newProductData(target.fields, l) } } : {}),
        };
      });
      const storeText = plan.store ? built.data[plan.store.key] : undefined;
      const group = read?.receipt
        ? {
            field: read.receipt.key,
            type_id: read.receipt.type_id,
            name: read.store?.name ?? (typeof storeText === "object" && storeText && "text" in storeText ? String(storeText.text) : ""),
            data: receiptData(read.receipt.fields, type.fields, built.data),
          }
        : undefined;
      const res = await api.post<{ ids: string[]; group?: string; created: (string | null)[]; spawned: { id: string; list: string }[] }>(`/projects/${project.project.id}/items/batch`, {
        type_id: type.id,
        items,
        ...(group ? { group } : {}),
      });
      // De foto bij het kasticket; een gekoppelde lijn onthoudt de naam op het ticket (het volgende ticket koppelt vanzelf).
      if (res.group && photo) {
        const body = new FormData();
        body.set("file", await prepareUpload(photo));
        await api.put(`/items/${res.group}/photo`, body).catch(() => toast("De foto kon niet bewaard worden", "alert"));
      }
      chosen.forEach((l, i) => {
        const id = l.product?.id ?? res.created[i];
        const name = l.product?.name ?? l.name;
        if (id && name.toLowerCase() !== l.ticket.toLowerCase()) api.post(`/items/${id}/alias`, { alias: l.ticket }).catch(() => undefined);
      });
      // Gekocht: open boodschappen van dezelfde producten afvinken.
      const products = [...new Set(chosen.flatMap((l, i) => (l.product?.id ?? res.created[i] ? [(l.product?.id ?? res.created[i])!] : [])))];
      const ticked = products.length ? await api.post<{ checked: Checked[] }>("/items/bought", { ids: products }).then((r) => r.checked).catch(() => []) : [];
      const n = res.ids.length;
      const fresh = res.created.filter(Boolean).length;
      const lists = [...new Set(res.spawned.map((s) => s.list))];
      const tickedIn = [...new Set(ticked.map((t) => t.list))];
      toast(
        `${n} ${n === 1 ? type.name.toLowerCase() : type.plural.toLowerCase()} bewaard` +
          (fresh ? `, ${fresh} ${fresh === 1 ? "nieuw product" : "nieuwe producten"}` : "") +
          (lists.length ? `, ook bij ${lists.join(" en ")}` : "") +
          (ticked.length ? `, ${ticked.length} afgevinkt bij ${tickedIn.join(" en ")}` : ""),
        "check",
        type.can_delete
          ? {
              label: "Ongedaan maken",
              run: () =>
                undoReceipt(
                  { lines: res.ids, spawned: res.spawned.map((s) => s.id), group: res.group ?? null, created: res.created.filter((x): x is string => Boolean(x)), ticked },
                  toast,
                ),
            }
          : undefined,
      );
      // Alles opnieuw ophalen (de totalen, de voorraad), niet enkel de lijst.
      window.dispatchEvent(new Event(REFRESH_EVENT));
      onDone();
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }

  const input = (ref: typeof cameraRef, camera: boolean) => (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      capture={camera ? "environment" : undefined}
      hidden
      onChange={(e) => {
        scan(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );
  const many = people.length > 1;

  return (
    <div className="form">
      {pending && pendingUrl && (
        <div className="shared-pending">
          <img src={pendingUrl} alt="Gedeelde foto" />
          <button
            type="button"
            className="btn btn-outline"
            disabled={status?.tone === "busy"}
            onClick={() => {
              setPending(null);
              scan(pending);
            }}
          >
            <Icon name="sparkles" /> Kasticket lezen
          </button>
        </div>
      )}
      {!read && (
        <div className="btn-row">
          <button type="button" className="btn btn-outline" title="Lezen met AI" disabled={status?.tone === "busy"} onClick={() => cameraRef.current?.click()}>
            <Icon name="camera" /> Foto <AiMark />
          </button>
          <button type="button" className="btn btn-outline" title="Lezen met AI" disabled={status?.tone === "busy"} onClick={() => fileRef.current?.click()}>
            <Icon name="image" /> Uit foto <AiMark />
          </button>
        </div>
      )}
      {input(cameraRef, true)}
      {input(fileRef, false)}
      {status && (
        <Alert tone={status.tone} ai={status.tone === "ok"}>
          {status.text}
        </Alert>
      )}
      {read && lines.length > 0 && (
        <>
          {common.length > 0 && <FieldInputs defs={common} value={head} onChange={(next) => setHead(next)} access={type.field_access} people={people} meId={person.id} />}
          <ul className="receipt-lines receipt-review">
            {lines.map((l, i) => (
              <li key={i} data-off={!l.on} data-open={open === i}>
                <div className="receipt-line-row">
                  <label className="receipt-line-check">
                    <input type="checkbox" checked={l.on} onChange={(e) => set(i, { on: e.target.checked })} aria-label={`${l.name} bewaren`} />
                  </label>
                  <button type="button" className="receipt-line-main" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                    <span className="receipt-line-name">{l.product?.name ?? l.name}</span>
                    <span className="hint">
                      {[l.amount !== null ? `${String(l.amount).replace(".", ",")}${l.unit && l.unit !== "stuk" ? ` ${l.unit}` : l.amount !== 1 ? "×" : ""}` : "", l.product ? (l.product.name.toLowerCase() !== l.ticket.toLowerCase() ? l.ticket : "") : l.newIn ? `nieuw in ${targetName(l.newIn)}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                  <span className="receipt-line-price">{formatCents(l.price)}</span>
                </div>
                {(plan.eaten || (plan.share && many)) && l.on && (
                  <div className="receipt-line-tags">
                    {plan.eaten && (
                      <button
                        type="button"
                        className="tag"
                        aria-pressed={l.eaten}
                        // Meteen opgegeten en nog geen product (een broodje): geen voorraad, dus enkel tekst.
                        onClick={() => set(i, { eaten: !l.eaten, ...(l.product ? {} : { newIn: l.eaten ? (targets[0]?.type_id ?? null) : null }) })}
                      >
                        {l.eaten && <Icon name="check" size={13} />} {type.fields.find((f) => f.key === plan.eaten)?.label}
                      </button>
                    )}
                    {plan.share && many && (
                      <button type="button" className="tag" aria-pressed={l.mine} onClick={() => set(i, { mine: !l.mine })}>
                        {l.mine && <Icon name="check" size={13} />} Van mij
                      </button>
                    )}
                  </div>
                )}
                {open === i && (
                  <div className="receipt-line-edit">
                    <label className="field">
                      <span className="label">{productDef.label}</span>
                      <ItemPicker
                        def={productDef}
                        value={l.product ? l.product.id : { text: l.name }}
                        disabled={false}
                        onChange={(v) => {
                          if (typeof v !== "string") return set(i, { product: null, name: v?.text ?? l.name, newIn: l.product ? (targets[0]?.type_id ?? null) : l.newIn });
                          set(i, { product: { id: v, name: l.product?.id === v ? l.product.name : l.name } });
                          // De naam van wat je koos (de keuzelijst geeft enkel de id).
                          api
                            .get<{ items: ItemRef[] }>(`/items?type=${plan.product.lists.join(",")}&ids=${v}`)
                            .then((r) => r.items[0] && set(i, { product: { id: v, name: r.items[0].name } }))
                            .catch(() => undefined);
                        }}
                      />
                    </label>
                    {!l.product && targets.length > 0 && (
                      <label className="field">
                        <span className="label">Nieuw product in</span>
                        <select value={l.newIn ?? ""} onChange={(e) => set(i, { newIn: e.target.value || null })}>
                          {targets.map((t) => (
                            <option key={t.type_id} value={t.type_id}>
                              {targetName(t.type_id)}
                            </option>
                          ))}
                          <option value="">Geen, enkel tekst</option>
                        </select>
                      </label>
                    )}
                    <div className="receipt-line-numbers">
                      {plan.amount && (
                        <label className="field">
                          <span className="label">{type.fields.find((f) => f.key === plan.amount)?.label}</span>
                          <input
                            inputMode="decimal"
                            value={l.amountText}
                            onChange={(e) => {
                              const n = Number(e.target.value.replace(",", "."));
                              set(i, { amountText: e.target.value, amount: e.target.value.trim() && Number.isFinite(n) ? n : null });
                            }}
                          />
                        </label>
                      )}
                      {unitDef && (
                        <label className="field">
                          <span className="label">{unitDef.label}</span>
                          {unitDef.type === "select" ? (
                            <select value={l.unit ?? ""} onChange={(e) => set(i, { unit: e.target.value || null })}>
                              <option value="" />
                              {unitDef.options?.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input value={l.unit ?? ""} onChange={(e) => set(i, { unit: e.target.value || null })} />
                          )}
                        </label>
                      )}
                      <label className="field">
                        <span className="label">{type.fields.find((f) => f.key === plan.price)?.label}</span>
                        <input inputMode="decimal" value={l.priceText} onChange={(e) => set(i, { priceText: e.target.value, price: parseEuro(e.target.value) })} />
                      </label>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="receipt-total">
            <span>Totaal</span>
            <strong>{formatCents(total)}</strong>
          </div>
          {ticketTotal !== null && ticketTotal > 0 && Math.abs(ticketTotal - lines.reduce((s, l) => s + (l.price ?? 0), 0)) > 1 && (
            <Alert tone="none">Op het ticket staat {formatCents(ticketTotal)}.</Alert>
          )}
          <button type="button" className="btn btn-primary btn-lg" disabled={busy || chosen.length === 0} onClick={save}>
            {busy ? "Bewaren…" : `Bewaar ${chosen.length} ${chosen.length === 1 ? type.name.toLowerCase() : type.plural.toLowerCase()}`}
          </button>
        </>
      )}
    </div>
  );
}
