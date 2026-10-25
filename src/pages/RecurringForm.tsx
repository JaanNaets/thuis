import { useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import { FREQUENCIES, type Frequency, type RecurringExpense, type RecurringInput, type Taxonomy } from "../../shared/types";
import { api, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { SubmitButton, Switch, TreeSelect } from "../components/Controls";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/Page";
import { buildSplit, initialSplitState, SplitEditor, type SplitState } from "../components/SplitEditor";
import { useToast } from "../components/Toast";
import { VendorField } from "../components/VendorField";
import { centsToInput, formatDate, parseEuro, today } from "../format";
import { addPerson } from "../people";
import { useNavigate } from "../router";
import { useSession } from "../session";
import { categoryTree, splitCandidates, useTaxonomy } from "../taxonomy";

export function RecurringFormPage() {
  const { id } = useParams();
  const { data: taxonomy, error } = useTaxonomy();
  if (error && !taxonomy) return <p className="error page">{error}</p>;
  if (!taxonomy) return null;
  if (!id) return <RecurringForm taxonomy={taxonomy} />;
  return <EditRecurring id={id} taxonomy={taxonomy} />;
}

function EditRecurring({ id, taxonomy }: { id: string; taxonomy: Taxonomy }) {
  const { data, error } = useApi<RecurringExpense>(`/expenses/recurring/${id}`);
  if (error) return <p className="error page">{error}</p>;
  if (!data) return null;
  return <RecurringForm existing={data} taxonomy={taxonomy} />;
}

/** Een vaste kost: elke week, maand, kwartaal of elk jaar vanzelf ingeboekt en verdeeld. */
function RecurringForm({ existing, taxonomy }: { existing?: RecurringExpense; taxonomy: Taxonomy }) {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { full } = useSession();
  const [params] = useSearchParams();
  const projectId = existing ? existing.project_id : (taxonomy.projects.find((p) => p.id === params.get("project"))?.id ?? null);
  const project = taxonomy.projects.find((p) => p.id === projectId);
  const back = project ? { to: `/projecten/${project.id}`, label: project.name } : { to: "/uitgaven", label: "Uitgaven" };

  const [description, setDescription] = useState(existing?.description ?? "");
  const [vendor, setVendor] = useState(existing?.vendor_name ?? "");
  const [amount, setAmount] = useState(existing ? centsToInput(existing.amount_cents) : "");
  const [categoryId, setCategoryId] = useState(existing?.category_id ?? null);
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? "monthly");
  const [startOn, setStartOn] = useState(existing?.start_on ?? today());
  const [endOn, setEndOn] = useState(existing?.end_on ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [active, setActive] = useState(existing ? existing.active === 1 : true);

  const used = existing
    ? [...existing.payments.flatMap((p) => (p.member_id ? [p.member_id] : [])), ...existing.split.participants.map((p) => p.member_id)]
    : [];
  const [extra, setExtra] = useState<string[]>([]);
  const { people, pots } = splitCandidates(taxonomy, projectId, full, [...used, ...extra]);
  const others = taxonomy.members.filter((m) => !people.some((p) => p.id === m.id));
  async function onAddPerson(name: string) {
    const member = await addPerson(taxonomy, projectId, name);
    setExtra((ids) => [...ids, member.id]);
    return member;
  }
  const defaults = project?.default_split ?? taxonomy.household.default_split;
  const [split, setSplit] = useState<SplitState>(() => initialSplitState({ meId: taxonomy.me.id, people, defaults, saved: existing }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const cents = parseEuro(amount);
  const validAmount = cents !== null && !Number.isNaN(cents) ? cents : null;

  /** Een merk dat je hier meestal koopt: die categorie alvast invullen. */
  function chooseVendor(name: string) {
    setVendor(name);
    const v = taxonomy.vendors.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (v?.category_id && !categoryId) setCategoryId(v.category_id);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validAmount) return setError("Vul een geldig bedrag in.");
    const built = buildSplit(split, validAmount);
    if ("error" in built) return setError(built.error);
    if (!built.split) return setError("Kies hoe het verdeeld wordt.");
    const input: RecurringInput = {
      project_id: projectId,
      description,
      vendor,
      amount_cents: validAmount,
      category_id: categoryId,
      frequency,
      start_on: startOn,
      end_on: endOn || null,
      payments: built.payments,
      split: built.split,
      notes,
      active: active ? 1 : 0,
    };
    setBusy(true);
    setError(undefined);
    try {
      if (existing) await api.put(`/expenses/recurring/${existing.id}`, input);
      else await api.post("/expenses/recurring", input);
      toast(existing ? "Terugkerende kost bijgewerkt" : "Terugkerende kost bewaard");
      navigate(back.to, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    const ok = await confirm({
      title: `"${existing.description}" stopzetten?`,
      body: "Wat al ingeboekt werd, blijft staan. Er komen enkel geen nieuwe meer bij.",
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/expenses/recurring/${existing.id}`);
    toast("Terugkerende kost verwijderd", "trash");
    navigate(back.to, { replace: true });
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead
        title={existing ? existing.description : "Terugkerende kost"}
        description={existing?.active ? `Volgende keer ${formatDate(existing.next_on)}` : existing ? "Gepauzeerd" : "Elke keer vanzelf ingeboekt en verdeeld"}
        back={back}
      />

      <section className="card form-section">
        <label className="field">
          <span className="label">Omschrijving</span>
          <input required maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="bv. Huur, Netflix, Energie" />
        </label>

        <div className="field">
          <span className="label">
            Verkoper <span className="optional">· verhuurder, leverancier, …</span>
          </span>
          <VendorField vendors={taxonomy.vendors} value={vendor} onChange={chooseVendor} placeholder="bv. Engie, de verhuurder" />
        </div>

        <div className="field-row">
          <label className="field">
            <span className="label">Bedrag</span>
            <input
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="€ 0,00"
              aria-invalid={Number.isNaN(cents)}
            />
          </label>
          <label className="field">
            <span className="label">Hoe vaak</span>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {Object.entries(FREQUENCIES).map(([key, f]) => (
                <option key={key} value={key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="label">Eerste keer</span>
            <input type="date" required value={startOn} onChange={(e) => setStartOn(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">
              Tot <span className="optional">· leeg = blijft lopen</span>
            </span>
            <input type="date" value={endOn} min={startOn} onChange={(e) => setEndOn(e.target.value)} />
          </label>
        </div>
        {!existing && startOn < today() && <span className="hint">Ligt de eerste keer in het verleden, dan worden de vorige keren meteen ingeboekt.</span>}

        <label className="field">
          <span className="label">Categorie</span>
          <TreeSelect nodes={categoryTree(taxonomy, "expense")} value={categoryId} onChange={setCategoryId} empty="Geen categorie" />
        </label>
      </section>

      <section className="card form-section">
        <SplitEditor
          amount={validAmount}
          people={people}
          pots={pots}
          meId={taxonomy.me.id}
          value={split}
          onChange={setSplit}
          allowLines={false}
          onAddPerson={full ? onAddPerson : undefined}
          suggestions={others}
        />
      </section>

      <section className="card form-section">
        {existing && (
          <Switch checked={active} onChange={setActive} label="Loopt" hint="Uit = gepauzeerd: er wordt niets meer ingeboekt tot je hem weer aanzet." />
        )}
        <label className="field">
          <span className="label">
            <Icon name="note" size={15} /> Notitie
          </span>
          <textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contractnummer, opzegtermijn, …" />
        </label>
      </section>

      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        {existing && (
          <button type="button" className="btn btn-danger-ghost" onClick={remove} disabled={busy}>
            <Icon name="trash" size={16} /> Verwijderen
          </button>
        )}
        <SubmitButton busy={busy} className="btn btn-primary btn-lg">
          {busy ? "Opslaan…" : "Opslaan"}
        </SubmitButton>
      </div>
    </form>
  );
}
