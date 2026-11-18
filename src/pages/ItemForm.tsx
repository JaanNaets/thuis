import { NAME } from "../../shared/views";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import type { Attributes, FieldDef } from "../../shared/fields";
import { canEdit, type ListDetail, type Item, type ItemRef } from "../../shared/model";
import { isProductCode, productData, productLabel } from "../../shared/product";
import type { Person } from "../../shared/types";
import { api, useApi } from "../api";
import { RequiredMark, SubmitButton } from "../components/Controls";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { AiMark, attributesDraft, buildAttributes, FieldInputs, findProduct, type Access, type AttributeDraft } from "../components/Fields";
import { Combo, useListItems } from "../components/ItemPicker";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/Page";
import { useToast } from "../components/Toast";
import { prepareUpload } from "../image";
import { enqueue, isOffline } from "../outbox";
import { useNavigate } from "../router";
import { clearShared, sharedFile } from "../shared-file";
import { readsPhoto, ITEMS_FORM } from "../../shared/photoread";
import { PhotoButton } from "../components/PhotoPicker";
import { useSession } from "../session";

/** `mirror`: gekoppeld (zie shared/transfer.ts); de naam en de velden in `locked` volgen de bron. */
type ItemDetail = { item: Item; list: { id: string }; mirror: { locked: string[] } | null };

/** Wat een foto opleverde (POST /lists/:id/items/read-photo). */
type PhotoRead = {
  name: string | null;
  data: Record<string, unknown>;
  source?: { kind: "database"; label: string; db: "off" | "nevo"; credit?: string } | { kind: "estimate" };
  message?: string;
};

/** Alles mag je wijzigen in een lijst waar je lid bent (er zijn geen rechten per veld). */
export const allEdit = (fields: FieldDef[]): Record<string, Access> => Object.fromEntries(fields.map((f) => [f.key, "edit" as const]));

/**
 * Een item toevoegen aan een lijst (`/lijsten/:id/nieuw`, met `?tekst=` als naam of `?veld=&op=` voor een datum) of
 * bewerken (`/items/:itemId/bewerken`). Zie STIJLBOEK.md → Formulier.
 */
export function ItemFormPage() {
  const { id, itemId } = useParams();
  const { data: existing } = useApi<ItemDetail>(itemId ? `/items/${itemId}` : null);
  const listId = id ?? existing?.list.id ?? null;
  const { data: detail, error } = useApi<ListDetail>(listId ? `/lists/${listId}` : null);
  if (error) return <p className="error page">{error}</p>;
  if (!detail || (itemId && !existing)) return <p className="page muted">Laden…</p>;
  return <ItemForm key={itemId ?? listId} detail={detail} item={existing?.item ?? null} locked={existing?.mirror?.locked ?? []} />;
}

function ItemForm({ detail, item, locked }: { detail: ListDetail; item: Item | null; locked: string[] }) {
  const { list, role } = detail;
  const toast = useToast();
  const navigate = useNavigate();
  const { person, ai } = useSession();
  const [params] = useSearchParams();
  const { data: people } = useApi<Person[]>("/me/people");
  const [name, setName] = useState(item?.name ?? params.get("tekst") ?? "");
  const [draft, setDraft] = useState<AttributeDraft>(() => {
    // Vooraf ingevuld in het palet (stap voor stap, Alles invullen): enkel de velden van de lijst tellen.
    let pre: Attributes = {};
    try {
      const raw = JSON.parse(params.get("vooraf") ?? "null");
      if (!item && raw && typeof raw === "object" && !Array.isArray(raw)) pre = raw as Attributes;
    } catch {
      pre = {};
    }
    const data = { ...pre, ...(item?.data ?? {}) };
    const field = params.get("veld");
    const day = params.get("op");
    if (!item && field && day && list.fields.some((f) => f.key === field && f.type === "date")) data[field] = day;
    return attributesDraft(list.fields, data);
  });
  const [partOf, setPartOf] = useState<string | null>(item?.part_of ?? null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  // Gekoppeld: wat uit de bron komt, toon je enkel (de server houdt het zo).
  const access = useMemo(() => ({ ...allEdit(list.fields), ...Object.fromEntries(locked.filter((k) => k !== NAME).map((k) => [k, "view" as const])) }), [list.fields, locked]);
  // Barcode (zonder AI, uit Open Food Facts) en Foto (✨): vullen in, en zeggen waar het vandaan komt.
  const products = list.fields.some((f) => f.product);
  const [scanning, setScanning] = useState(false);
  const [reading, setReading] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  // Leest deze lijst een foto (Instellen), en staat de AI voor jou aan?
  const reads = Boolean(ai && readsPhoto(list.read_photo, ITEMS_FORM, null));

  // Een gedeelde foto (of de foto bij de +): ze komt bij het item. Met `lezen=1` koos je al om ze te laten lezen;
  // anders leest de AI ze pas na een tik op Foto lezen.
  const [shared, setShared] = useState(false);
  const sharedTaken = useRef(false);
  useEffect(() => {
    // Eén keer (ook als React het effect twee keer draait): anders leest de AI dezelfde foto twee keer.
    if (sharedTaken.current) return;
    sharedTaken.current = true;
    if (!item && params.get("foto") === "gedeeld")
      sharedFile().then((f) => {
        if (!f) return;
        setPhoto(f);
        clearShared();
        if (params.get("lezen") === "1" && reads) byPhoto(f);
        else setShared(reads);
      });
  }, []);

  function fill(nextName: string | null, data: Record<string, unknown>) {
    if (nextName) setName(nextName);
    setDraft((cur) => ({
      ...cur,
      ...attributesDraft(
        list.fields.filter((f) => data[f.key] !== undefined && data[f.key] !== null),
        data as never,
      ),
    }));
  }

  async function byCode(code: string) {
    setScanning(false);
    if (!isProductCode(code)) return toast("Dat is geen barcode van een product", "alert");
    try {
      const info = await findProduct(code);
      if (!info) return toast("Niet gevonden in Open Food Facts", "alert");
      fill(productLabel(info), productData(list.fields, info));
      setSource(`Uit Open Food Facts: ${productLabel(info)}`);
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }

  async function byPhoto(file: File) {
    setReading(true);
    try {
      const form = new FormData();
      form.set("image", await prepareUpload(file));
      const read = await api.post<PhotoRead>(`/lists/${list.id}/items/read-photo`, form);
      if (read.message) toast(read.message, "alert");
      fill(read.name, read.data);
      setPhoto(file);
      setShared(false);
      const src = read.source;
      setSource(
        src?.kind === "database"
          ? `${src.db === "nevo" ? "Uit NEVO" : "Uit Open Food Facts"}: ${src.label}${src.credit ? ` (${src.credit})` : ""}`
          : src?.kind === "estimate"
            ? "Geschat met AI"
            : read.name || Object.keys(read.data).length
              ? "Gelezen met AI"
              : null,
      );
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setReading(false);
    }
  }

  if (!canEdit(role)) return <p className="page muted">Je mag in deze lijst enkel kijken.</p>;

  async function save(e: FormEvent, again = false) {
    e.preventDefault();
    const built = buildAttributes(list.fields, draft);
    if ("error" in built) return setProblem(built.error);
    if (!name.trim()) return setProblem(`Geef ${list.one?.toLowerCase() ?? "het"} een naam`);
    setBusy(true);
    setProblem(undefined);
    const body = { name: name.trim(), data: built.data, part_of: partOf };
    try {
      if (item) {
        await api.put(`/items/${item.id}`, body);
        toast(`${name.trim()} bewaard`);
        navigate(`/items/${item.id}`, { replace: true });
      } else {
        const { id } = await api.post<{ id: string }>(`/lists/${list.id}/items`, body);
        if (photo) {
          const form = new FormData();
          form.set("file", await prepareUpload(photo));
          await api.put(`/items/${id}/photo`, form).catch((err: Error) => toast(err.message, "alert"));
        }
        toast(`${name.trim()} toegevoegd`);
        if (again) {
          setPhoto(null);
          setSource(null);
          setName("");
          setDraft(attributesDraft(list.fields, {}));
          setPartOf(null);
        } else navigate(`/items/${id}`, { replace: true });
      }
    } catch (err) {
      if (!item && isOffline(err)) {
        await enqueue("item", list.id, name.trim(), body);
        toast(`${name.trim()} wacht op internet`);
        navigate(`/lijsten/${list.id}`, { replace: true });
        return;
      }
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form page" onSubmit={(e) => save(e)}>
      <PageHead title={item ? `${item.name} bewerken` : `${list.one} toevoegen`} back={{ to: -1, label: list.name }} />
      <section className="card form-section">
        <label className="field">
          <span className="label">
            Naam
            <RequiredMark />
          </span>
          <input value={name} required maxLength={200} autoFocus={!item} disabled={locked.includes(NAME)} onChange={(e) => setName(e.target.value)} />
        </label>
        {!item && (
          <div className="field">
            <div className="btn-row photo-row">
              {products && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setScanning(true)}>
                  <Icon name="scan" size={15} /> Barcode
                </button>
              )}
              {shared && photo ? (
                <button type="button" className="btn btn-sm btn-primary" disabled={reading} onClick={() => byPhoto(photo)}>
                  <Icon name="camera" size={15} /> {reading ? "Lezen…" : "Foto lezen"} <AiMark />
                </button>
              ) : (
                <PhotoButton
                  read={reads ? true : null}
                  busy={reading}
                  onPhoto={(file, read) => {
                    setPhoto(file);
                    setSource(null);
                    if (read) byPhoto(file);
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
                      setShared(false);
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
        <FieldInputs defs={list.fields} value={draft} onChange={(next) => setDraft(next)} access={access} people={people ?? []} meId={person.id} />
      </section>
      <section className="card form-section">
        <PartOfPicker value={partOf} onChange={setPartOf} self={item?.id ?? null} />
      </section>
      {scanning && <BarcodeScanner onResult={(r) => byCode(r.rawValue)} onClose={() => setScanning(false)} />}
      {problem && <p className="error">{problem}</p>}
      <div className="btn-row">
        <SubmitButton busy={busy} className="btn btn-primary btn-lg">
          Opslaan
        </SubmitButton>
        {!item && (
          <button type="button" className="btn btn-outline btn-lg" disabled={busy} onClick={(e) => save(e as unknown as FormEvent, true)}>
            Opslaan en volgende
          </button>
        )}
      </div>
    </form>
  );
}

/** Deel van een ander item (de pedalen van de fiets): kies uit al je lijsten. */
function PartOfPicker({ value, onChange, self }: { value: string | null; onChange: (id: string | null) => void; self: string | null }) {
  const [text, setText] = useState<string | null>(null);
  const { options, placeOf, nameOf } = useListItems([], text ?? "", value ? [value] : []);
  const shown = text ?? (value ? nameOf(value) : "");
  return (
    <div className="field">
      <span className="label">Deel van</span>
      <div className="picker-row">
        <Combo
          label="Deel van"
          text={shown}
          options={options?.filter((o: ItemRef) => o.id !== self)}
          placeOf={placeOf}
          disabled={false}
          placeholder="Zoek of kies…"
          onText={(t) => {
            setText(t);
            if (!t.trim()) onChange(null);
          }}
          onPick={(o) => {
            setText(null);
            onChange(o.id);
          }}
          onLeave={() => setText(null)}
        />
        {value && (
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Deel van leegmaken" onClick={() => onChange(null)}>
            <Icon name="close" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
