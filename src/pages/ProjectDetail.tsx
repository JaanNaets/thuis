import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { SPLIT_LABELS } from "../../shared/split";
import type { Member, ProjectDetail as Detail, Taxonomy } from "../../shared/types";
import { api, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { Avatar, CardHead, Segmented, SubmitButton } from "../components/Controls";
import { Icon } from "../components/Icon";
import { BalancesCard, CategoryBars, EntryRow, PotsCard, RecurringCard } from "../components/Ledger";
import { stagger, useCountUp } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { formatCents } from "../format";
import { Link, useNavigate } from "../router";
import { useSession } from "../session";
import { refreshTaxonomy, useTaxonomy } from "../taxonomy";
import { periodText } from "./ProjectList";

export function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { full } = useSession();
  const { data: p, error, reload } = useApi<Detail>(`/projects/${id}`);
  const { data: taxonomy } = useTaxonomy();
  const [adding, setAdding] = useState(false);

  if (error) return <p className="error page">{error}</p>;
  if (!p || !taxonomy) return null;

  const changed = () => {
    reload();
    refreshTaxonomy();
  };
  const newExpense = `/aankopen/nieuw?project=${p.id}`;
  const period = periodText(p.start_on, p.end_on);

  async function setArchived(archived: boolean) {
    if (!p) return;
    await api.put(`/projects/${p.id}/archived`, { archived });
    toast(archived ? "Project gearchiveerd" : "Project weer actief", archived ? "archive" : undefined);
    changed();
  }

  async function remove() {
    if (!p) return;
    const ok = await confirm({ title: `"${p.name}" verwijderen?`, confirmLabel: "Verwijderen", danger: true });
    if (!ok) return;
    try {
      await api.delete(`/projects/${p.id}`);
    } catch (err) {
      return toast((err as Error).message, "alert");
    }
    refreshTaxonomy();
    toast("Project verwijderd", "trash");
    navigate("/projecten", { replace: true });
  }

  async function removeMember(m: Member) {
    if (!p) return;
    const ok = await confirm({ title: `${m.name} uit het project halen?`, confirmLabel: "Uit het project", danger: true });
    if (!ok) return;
    try {
      await api.delete(`/projects/${p.id}/members/${m.id}`);
      toast(`${m.name} doet niet meer mee`);
      changed();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }

  return (
    <article className="page">
      <PageHead
        title={p.name}
        badge={p.archived ? <span className="badge">Gearchiveerd</span> : undefined}
        description={period ?? p.description ?? undefined}
        back={{ to: "/projecten", label: "Projecten" }}
        actions={
          full && (
            <Link to={`/projecten/${p.id}/bewerken`} className="btn btn-outline btn-sm">
              <Icon name="edit" size={15} /> Bewerken
            </Link>
          )
        }
        primary={
          !p.archived && (
            <Link to={newExpense} className="btn btn-primary">
              <Icon name="plus" size={16} /> Nieuwe uitgave
            </Link>
          )
        }
      />

      <div className="split">
        <aside className="split-aside">
          <section className="card">
            <ProjectTotal project={p} />
            <dl className="dl">
              {period && (
                <div>
                  <dt>Periode</dt>
                  <dd>{period}</dd>
                </div>
              )}
              <div>
                <dt>Saldo</dt>
                <dd>{p.separate_balance ? "Eigen saldo" : "Telt mee bij het huishouden"}</dd>
              </div>
              <div>
                <dt>Verdeling</dt>
                <dd>{p.default_split ? SPLIT_LABELS[p.default_split.mode] : "Gelijk"}</dd>
              </div>
            </dl>
            {p.description && period && (
              <p className="note-block">
                <Icon name="note" size={16} />
                <span>{p.description}</span>
              </p>
            )}
          </section>

          <section className="card">
            <CardHead
              icon="users"
              title="Wie doet mee"
              description={p.members.some((m) => m.access === "projects") ? "Gasten zien enkel dit project" : undefined}
              action={
                full && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(true)}>
                    <Icon name="userPlus" size={15} /> Deelnemer
                  </button>
                )
              }
            />
            <ul className="rows">
              {p.members.map((m) => (
                <li key={m.id}>
                  <div className="row" style={{ minHeight: 52 }}>
                    <span className="cell-main">
                      <Avatar member={m} />
                      <span className="row-main">
                        <span className="row-title">{m.id === taxonomy.me.id ? `${m.name} (ik)` : m.name}</span>
                        <span className="row-meta">
                          <span>{m.access === "projects" ? (m.email ? `gast · ${m.email}` : "gast · meldt niet aan") : "huishouden"}</span>
                        </span>
                      </span>
                    </span>
                    {full && m.id !== taxonomy.me.id && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => removeMember(m)}
                        aria-label={`${m.name} uit het project halen`}
                      >
                        <Icon name="close" size={15} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {p.summary && (
            <>
              <BalancesCard summary={p.summary} taxonomy={taxonomy} people={p.members} projectId={p.id} onChanged={changed} />
              <PotsCard pots={p.summary.pots} taxonomy={taxonomy} people={p.members} projectId={p.id} onChanged={changed} />
            </>
          )}
        </aside>

        <div className="split-main">
          {p.by_category.length > 0 && (
            <section className="card">
              <CardHead icon="wallet" title="Per categorie" />
              <CategoryBars rows={p.by_category} />
            </section>
          )}

          <h2 className="section-title">Uitgaven</h2>
          {p.entries.length === 0 ? (
            <EmptyState
              icon="receipt"
              title="Nog geen uitgaven"
              action={
                !p.archived && (
                  <Link to={newExpense} className="btn btn-outline btn-sm">
                    <Icon name="plus" size={16} /> Eerste uitgave
                  </Link>
                )
              }
            >
              Wie iets betaalt voor het project, zet het hier: de app houdt bij wie wie nog moet.
            </EmptyState>
          ) : (
            <div className="card table table-entries">
              <div className="table-head" aria-hidden="true">
                <span>Omschrijving</span>
                <span>Betaald door</span>
                <span>Datum</span>
                <span className="end">Bedrag</span>
              </div>
              <ul className="rows stagger">
                {p.entries.map((e, i) => (
                  <li key={`${e.kind}-${e.id}`} style={stagger(i)}>
                    <EntryRow
                      entry={e}
                      taxonomy={taxonomy}
                      inProject
                      onDeleted={(label) => {
                        toast(`${label} verwijderd`, "trash");
                        changed();
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <RecurringCard items={p.recurring} taxonomy={taxonomy} projectId={p.id} />

          {full && (
            <div className="btn-row" style={{ justifySelf: "start" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setArchived(!p.archived)}>
                <Icon name="archive" size={16} /> {p.archived ? "Weer actief maken" : "Archiveren"}
              </button>
              {/* Met uitgaven erin kan een project enkel nog gearchiveerd worden. */}
              {p.entries.length === 0 && (
                <button type="button" className="btn btn-danger-ghost" onClick={remove}>
                  <Icon name="trash" size={16} /> Verwijderen
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {!p.archived && (
        <Link to={newExpense} className="fab" aria-label="Nieuwe uitgave">
          <Icon name="plus" size={24} />
        </Link>
      )}

      <Sheet open={adding} title="Deelnemer toevoegen" onClose={() => setAdding(false)}>
        {adding && (
          <AddMemberForm
            project={p}
            taxonomy={taxonomy}
            onDone={(name) => {
              setAdding(false);
              toast(`${name} doet mee`);
              changed();
            }}
          />
        )}
      </Sheet>
    </article>
  );
}

/** Uitgegeven, met het budget als meter eronder. */
function ProjectTotal({ project }: { project: Detail }) {
  const total = useCountUp(project.total_cents);
  const budget = project.budget_cents;
  const ratio = budget ? project.total_cents / budget : 0;
  return (
    <div className="purchase-summary">
      <span className="amount-big">{formatCents(total)}</span>
      <span className="muted">{project.expense_count === 1 ? "1 uitgave" : `${project.expense_count} uitgaven`}</span>
      {budget !== null && budget > 0 && (
        <div className="budget" data-over={ratio > 1} title={`${Math.round(ratio * 100)}% van het budget`}>
          <span className="budget-track">
            <span className="bar" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </span>
          <span className="budget-text">
            {ratio > 1
              ? `${formatCents(project.total_cents - budget)} over het budget`
              : `nog ${formatCents(budget - project.total_cents)} van ${formatCents(budget)}`}
          </span>
        </div>
      )}
    </div>
  );
}

/** Iemand van het huishouden erbij, of een gast van buiten (die enkel dit project ziet). */
function AddMemberForm({ project, taxonomy, onDone }: { project: Detail; taxonomy: Taxonomy; onDone: (name: string) => void }) {
  const others = taxonomy.members.filter((m) => !project.member_ids.includes(m.id));
  const [who, setWho] = useState<"existing" | "guest">(others.length ? "existing" : "guest");
  const [memberId, setMemberId] = useState(others[0]?.id ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Iemand die al mee deelt zonder aan te melden: wordt dezelfde persoon.
  const twin =
    who === "guest" ? taxonomy.members.find((m) => !m.email && m.access === "projects" && m.name.toLowerCase() === name.trim().toLowerCase()) : undefined;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const member = await api.post<Member>(
        `/projects/${project.id}/members`,
        who === "existing" ? { member_id: memberId } : { name, email: email.trim() || null },
      );
      onDone(member.name);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      {others.length > 0 && (
        <Segmented
          label="Wie"
          value={who}
          onChange={setWho}
          options={[
            { value: "existing", label: "Al gekend" },
            { value: "guest", label: "Iemand nieuw" },
          ]}
        />
      )}
      {who === "existing" ? (
        <label className="field">
          <span className="label">Wie</span>
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} required>
            {others.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.access === "projects" ? " (gast)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className="field">
            <span className="label">Naam</span>
            <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Lien" />
          </label>
          {twin && (
            <span className="hint" style={{ marginTop: -8 }}>
              {twin.name} deelt al mee zonder aan te melden: dat wordt dezelfde persoon, met alles wat al gedeeld werd.
            </span>
          )}
          <label className="field">
            <span className="label">
              E-mailadres <span className="optional">· om zelf aan te melden</span>
            </span>
            <input type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lien@voorbeeld.be" />
            <span className="hint">Met een e-mailadres kan die zelf uitgaven toevoegen. Die ziet enkel de projecten waarin die meedoet.</span>
          </label>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <SubmitButton busy={busy}>Toevoegen</SubmitButton>
      </div>
    </form>
  );
}
