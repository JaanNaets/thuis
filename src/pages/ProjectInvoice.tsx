import { useState, type CSSProperties, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import { fieldWithRole, parseInvoiceLine, templateOf, type Attributes } from "../../shared/fields";
import { UNITS, type ItemInput, type Project, type PurchaseDetail, type PurchaseListItem, type Taxonomy } from "../../shared/types";
import { api, apiUrl, useApi } from "../api";
import { Alert, CardHead, SubmitButton } from "../components/Controls";
import { Icon } from "../components/Icon";
import { SkeletonRows, stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { buildOwners, OwnersField, ownersDraft, ownersFromPurchase } from "../components/ProjectFields";
import { useToast } from "../components/Toast";
import { centsToInput, formatCents, formatDate, formatNumber, parseEuro, parseQuantity } from "../format";
import { prepareForReading } from "../image";
import { Link, useNavigate } from "../router";
import { activeMembers, projectMembers, refreshTaxonomy, useTaxonomy } from "../taxonomy";

/**
 * Een factuur van de wijnhandel (of de fietsenmaker) per lijn in het project zetten: elke lijn wordt een ding,
 * met het aantal, de prijs per stuk en de uitgave eraan gekoppeld.
 */
export function ProjectInvoice() {
  const { projectId } = useParams();
  const [params] = useSearchParams();
  const { data: taxonomy, error } = useTaxonomy();
  if (error && !taxonomy) return <p className="error page">{error}</p>;
  if (!taxonomy) return null;
  const project = taxonomy.projects.find((p) => p.id === projectId);
  if (!project) return <p className="error page">Dit project bestaat niet (meer).</p>;
  const purchaseId = params.get("aankoop");
  return purchaseId ? <InvoiceLines key={purchaseId} project={project} taxonomy={taxonomy} purchaseId={purchaseId} /> : <ChoosePurchase project={project} />;
}

/** Eerst de uitgave kiezen: de factuur staat er als foto of PDF bij. */
function ChoosePurchase({ project }: { project: Project }) {
  const { data, error, loading } = useApi<PurchaseListItem[]>(`/purchases?project=${project.id}`);
  return (
    <div className="page form">
      <PageHead title="Uit factuur" back={{ to: -1, label: project.name }} />
      <section className="card">
        <CardHead
          icon="receipt"
          title="Welke factuur"
          description="Kies de uitgave met de factuur. Nog niet ingegeven? Zet ze eerst als uitgave, met de foto of PDF."
          action={
            <Link to={`/aankopen/nieuw?project=${project.id}`} className="btn btn-outline btn-sm">
              <Icon name="plus" size={15} /> Nieuwe uitgave
            </Link>
          }
        />
        {error && <p className="error card-body">{error}</p>}
        {!data && loading && <SkeletonRows rows={3} />}
        {data && data.length === 0 && (
          <EmptyState icon="receipt" title="Nog geen uitgaven in dit project">
            Trek een foto van de factuur bij een nieuwe uitgave; daarna zet je hier elke lijn om.
          </EmptyState>
        )}
        {data && data.length > 0 && (
          <ul className="rows stagger">
            {data.map((p, i) => (
              <li key={p.id} style={stagger(i)}>
                <Link to={`/projecten/${project.id}/factuur?aankoop=${p.id}`} replace className="row">
                  <span className="cell-main">
                    <span className="row-media tone-sky">
                      <Icon name="receipt" size={16} />
                    </span>
                    <span className="row-main">
                      <span className="row-title">{p.description}</span>
                      <span className="row-meta">
                        <span>{[p.vendor_name, formatDate(p.purchased_on)].filter(Boolean).join(" · ")}</span>
                        {p.file_count > 0 && <span className="badge">{p.file_count === 1 ? "1 bestand" : `${p.file_count} bestanden`}</span>}
                      </span>
                    </span>
                  </span>
                  <span className="row-end">{p.amount_cents !== null ? formatCents(p.amount_cents) : "—"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Line = { on: boolean; name: string; quantity: string; amount: string; attributes: Attributes };

function InvoiceLines({ project, taxonomy, purchaseId }: { project: Project; taxonomy: Taxonomy; purchaseId: string }) {
  const { data: purchase, error } = useApi<PurchaseDetail>(`/purchases/${purchaseId}`);
  if (error) return <p className="error page">{error}</p>;
  if (!purchase) return null;
  return <InvoiceForm project={project} taxonomy={taxonomy} purchase={purchase} />;
}

function InvoiceForm({ project, taxonomy, purchase }: { project: Project; taxonomy: Taxonomy; purchase: PurchaseDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const template = templateOf(project.template);
  const unit = project.item_unit ?? "stuk";
  const priceField = fieldWithRole(project.fields, "unit_price");
  const toLine = (description: string, amount_cents: number): Line => {
    const parsed = parseInvoiceLine(description, project.fields);
    return { on: amount_cents > 0, name: parsed.name, quantity: String(parsed.quantity), amount: centsToInput(amount_cents), attributes: parsed.attributes };
  };
  // Al per lijn verdeeld? Dan zijn de lijnen er al.
  const [lines, setLines] = useState<Line[]>(() => purchase.lines.map((l) => toLine(l.description, l.amount_cents)));
  const residents = activeMembers(taxonomy);
  const people = [...residents, ...projectMembers(taxonomy, project.id)].filter((m, i, list) => list.findIndex((x) => x.id === m.id) === i);
  const [owners, setOwners] = useState(() => ownersDraft(ownersFromPurchase(purchase, residents)));
  const [reading, setReading] = useState<{ tone: "busy" | "ok" | "none"; text: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const file = purchase.files.find((f) => f.content_type.startsWith("image/") || f.content_type === "application/pdf");
  const already = new Set(purchase.links.map((l) => l.item_name.toLowerCase()));

  async function read() {
    if (!file) return;
    setReading({ tone: "busy", text: "Factuur lezen" });
    try {
      const blob = await fetch(apiUrl(`/files/${file.id}`)).then((r) => {
        if (!r.ok) throw new Error("De factuur kon niet geopend worden.");
        return r.blob();
      });
      const body = new FormData();
      if (file.content_type === "application/pdf") {
        const { pdfText, pdfFirstPageImage } = await import("../pdf");
        const pdf = new File([blob], file.filename, { type: file.content_type });
        body.append("text", await pdfText(pdf));
        const image = await pdfFirstPageImage(pdf).catch(() => null);
        if (image) body.append("image", image);
      } else {
        body.append("image", await prepareForReading(new File([blob], file.filename, { type: file.content_type })));
      }
      const result = await api.post<{ lines: { description: string; amount_cents: number }[]; message?: string }>("/receipts/lines", body);
      if (result.lines.length) setLines(result.lines.map((l) => toLine(l.description, l.amount_cents)));
      setReading(
        result.lines.length
          ? { tone: "ok", text: `${result.lines.length} lijnen gelezen. Vink uit wat geen ${template.name_label.toLowerCase()} is (verzending, korting).` }
          : { tone: "none", text: result.message ?? "Geen lijnen gevonden. Voeg ze zelf toe." },
      );
    } catch (err) {
      setReading({ tone: "none", text: (err as Error).message });
    }
  }

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const chosen = lines.filter((l) => l.on);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const builtOwners = buildOwners(owners);
    if ("error" in builtOwners) return setError(builtOwners.error);
    const prepared = [];
    for (const l of chosen) {
      const quantity = parseQuantity(l.quantity);
      const amount = l.amount.trim() ? parseEuro(l.amount) : null;
      if (!l.name.trim()) return setError("Elke lijn heeft een naam nodig.");
      if (quantity === null || Number.isNaN(quantity) || quantity <= 0) return setError(`Het aantal bij ${l.name} is niet geldig.`);
      if (Number.isNaN(amount)) return setError(`Het bedrag bij ${l.name} is niet geldig.`);
      prepared.push({ line: l, quantity, amount });
    }
    setBusy(true);
    setError(undefined);
    try {
      for (const { line, quantity, amount } of prepared) {
        const attributes = { ...line.attributes };
        if (priceField && amount) attributes[priceField.key] = Math.round(amount / quantity);
        const input: ItemInput = {
          name: line.name.trim(),
          type: project.item_type ?? "consumable",
          category_id: null,
          default_location_id: null,
          unit,
          barcode: null,
          brand: null,
          vendor: null,
          min_quantity: null,
          notes: null,
          parent_id: null,
          origin: project.item_type === "asset" ? "bought" : null,
          origin_note: null,
          acquired_on: project.item_type === "asset" ? purchase.purchased_on : null,
          value_cents: null,
          content_amount: null,
          content_unit: null,
          project_id: project.id,
          attributes,
          owners: builtOwners.owners,
          tag_ids: [],
          initial: {
            quantity: project.item_type === "asset" ? 1 : quantity,
            location_id: null,
            expires_on: null,
            purchase_id: purchase.id,
            amount_cents: amount,
          },
        };
        await api.post("/items", input);
      }
      refreshTaxonomy();
      toast(
        prepared.length === 1 ? `1 ${template.name_label.toLowerCase()} toegevoegd` : `${prepared.length} ${template.plural_label.toLowerCase()} toegevoegd`,
      );
      navigate(`/projecten/${project.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead title="Uit factuur" back={{ to: -1, label: project.name }} />

      <Alert tone="ok">
        Van de uitgave "{purchase.description}" ({formatDate(purchase.purchased_on)}
        {purchase.amount_cents !== null ? `, ${formatCents(purchase.amount_cents)}` : ""}): elke lijn wordt een {template.name_label.toLowerCase()}, met de
        uitgave eraan.
      </Alert>

      <section className="card form-section">
        <div className="field">
          <span className="label">Lijnen</span>
          <span className="hint">
            Aantal en jaargang haalt de app uit de omschrijving ("6x Chablis 2019"). Het bedrag is voor de hele lijn
            {priceField ? `; de prijs per ${unit} komt bij ${priceField.label.toLowerCase()}` : ""}.
          </span>
        </div>
        {file && (
          <div className="btn-row">
            <button type="button" className="btn btn-outline" disabled={reading?.tone === "busy"} onClick={read}>
              <Icon name="sparkles" /> Lijnen lezen uit de factuur
            </button>
          </div>
        )}
        {!file && lines.length === 0 && <span className="hint">Er hangt geen foto of PDF aan deze uitgave: vul de lijnen zelf in.</span>}
        {reading && <Alert tone={reading.tone}>{reading.text}</Alert>}

        {lines.length > 0 && (
          <ul className="invoice-lines">
            {lines.map((l, i) => {
              const quantity = parseQuantity(l.quantity);
              const amount = l.amount.trim() ? parseEuro(l.amount) : null;
              const per = quantity && amount && !Number.isNaN(quantity) && !Number.isNaN(amount) ? Math.round(amount / quantity) : null;
              return (
                <li key={i} className="invoice-line" data-off={!l.on} style={{ "--i": i } as CSSProperties}>
                  <input type="checkbox" checked={l.on} onChange={(e) => update(i, { on: e.target.checked })} aria-label={`${l.name || "Lijn"} toevoegen`} />
                  <input className="invoice-name" value={l.name} maxLength={200} aria-label="Naam" onChange={(e) => update(i, { name: e.target.value })} />
                  <span className="invoice-numbers">
                    <span className="split-input" data-unit="×">
                      <input inputMode="decimal" value={l.quantity} aria-label="Aantal" onChange={(e) => update(i, { quantity: e.target.value })} />
                    </span>
                    <span className="split-input" data-unit="€">
                      <input inputMode="decimal" value={l.amount} aria-label="Bedrag van de lijn" onChange={(e) => update(i, { amount: e.target.value })} />
                    </span>
                    <span className="invoice-per">
                      {per ? `${formatCents(per)}/${unit}` : ""}
                      {already.has(l.name.trim().toLowerCase()) && <span className="badge">al gekoppeld</span>}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ justifySelf: "start" }}
          onClick={() => setLines((ls) => [...ls, { on: true, name: "", quantity: "1", amount: "", attributes: {} }])}
        >
          <Icon name="plus" size={15} /> Lijn toevoegen
        </button>
      </section>

      <section className="card form-section">
        <OwnersField people={people} meId={taxonomy.me.id} value={owners} onChange={setOwners} />
      </section>

      {error && <p className="error">{error}</p>}

      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        {busy
          ? "Toevoegen…"
          : chosen.length === 1
            ? `1 ${template.name_label.toLowerCase()} toevoegen`
            : `${formatNumber(chosen.length)} ${template.plural_label.toLowerCase()} toevoegen`}
      </SubmitButton>
      {chosen.length > 0 && project.item_type === "consumable" && (
        <span className="hint" style={{ textAlign: "center" }}>
          Samen {formatNumber(chosen.reduce((sum, l) => sum + (parseQuantity(l.quantity) || 0), 0))} {UNITS[unit]}
        </span>
      )}
    </form>
  );
}
