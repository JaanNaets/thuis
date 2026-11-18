// Een formulier instellen (enkel een beheerder; zie STIJLBOEK.md → Wat een formulier doet): Formulier · Mensen
// (`?tab=`). Een nieuw formulier (/formulieren/nieuw) begint van een vertrekpunt; wat het vraagt en doet, pas je daarna
// aan. Een formulier hoort bij geen lijst: wat het invult, zeggen zijn groepen lijnen en handelingen.

import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { NOTIFY_CHOICES } from "../../shared/alerts";
import { BALANCE, presetDoes, type ListColumns } from "../../shared/cells";
import type { IconKey } from "../../shared/icons";
import { baseParts, BASES, canManage, isBase, LINE_ROLES, type Base, type FormDetail, type Parts } from "../../shared/model";
import { formReads } from "../../shared/photoread";
import { api, useApi } from "../api";
import { Switch, Tabs } from "../components/Controls";
import { useConfirm } from "../components/ConfirmDialog";
import { buildDoes, DoesEditor, doesDraft, GroupsEditor, type DoesDraft } from "../components/Does";
import { AiMark, buildFields, FieldsEditor, fieldsDraft, type FieldDraft } from "../components/Fields";
import { Icon } from "../components/Icon";
import { IconPicker } from "../components/IconPicker";
import { PageHead } from "../components/Page";
import { PeopleEditor } from "../components/People";
import { TagChooser } from "../components/TagChooser";
import { useToast } from "../components/Toast";
import { useNavigate } from "../router";
import { useSession } from "../session";

type Tab = "formulier" | "mensen";

export function FormSettings() {
  const { id } = useParams();
  const { data: detail, error, reload } = useApi<FormDetail>(`/forms/${id}`);
  const [params, setParams] = useSearchParams();
  if (error && !detail) return <p className="error page">{error}</p>;
  if (!detail) return <p className="page muted">Laden…</p>;
  if (!canManage(detail.role)) return <p className="page muted">Enkel een beheerder kan dit formulier instellen.</p>;
  const tabs: { value: Tab; label: string }[] = [
    { value: "formulier", label: "Formulier" },
    { value: "mensen", label: "Mensen" },
  ];
  const asked = params.get("tab") as Tab | null;
  const tab = asked && tabs.some((t) => t.value === asked) ? asked : "formulier";
  return (
    <div className="page form">
      <PageHead title="Instellen" back={{ to: `/formulieren/${detail.form.id}`, label: detail.form.name }} />
      <Tabs label="Onderwerp" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={tabs} />
      {tab === "formulier" && <FormEditor key={detail.form.id} detail={detail} onSaved={reload} />}
      {tab === "mensen" && <PeopleEditor base={`/forms/${detail.form.id}`} people={detail.people} onSaved={reload} />}
    </div>
  );
}

/** Een nieuw formulier; met `?lijst=` vult zijn eerste groep lijnen die lijst in (Nieuw formulier vanop een lijst). */
export function FormNew() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { lists } = useSession();
  const list = lists.find((l) => l.id === params.get("lijst"));
  return (
    <div className="page form">
      <PageHead title="Nieuw formulier" back={list ? { to: `/lijsten/${list.id}`, label: list.name } : { to: "/lijsten", label: "Lijsten" }} />
      <FormEditor detail={null} list={list?.id} onSaved={(id) => navigate(`/formulieren/${id}`, { replace: true })} />
    </div>
  );
}

function FormEditor({ detail, list, onSaved }: { detail: FormDetail | null; list?: string; onSaved: (id: string) => void }) {
  const kind = detail?.form ?? null;
  const { person, lists, tags, reloadMe } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const startParts = (b: Base): Parts => {
    const p = baseParts(b);
    return list ? { ...p, groups: p.groups.map((g, i) => (i === 0 ? { ...g, list } : g)) } : p;
  };
  const [base, setBase] = useState<Base>(kind?.base ?? "gebruik");
  const [parts, setParts] = useState<Parts>(() => kind?.parts ?? startParts("gebruik"));
  const [name, setName] = useState(kind?.name ?? "");
  const [icon, setIcon] = useState<IconKey | null>((kind?.icon as IconKey) ?? null);
  const [goal, setGoal] = useState(kind?.goal ? String(Math.round(kind.goal / 60)) : "");
  const [planned, setPlanned] = useState(kind?.planned ?? false);
  const [drafts, setDrafts] = useState<FieldDraft[]>(() => fieldsDraft(kind?.fields ?? []));
  const [does, setDoes] = useState<DoesDraft[]>(() => doesDraft(kind?.does ?? presetDoes("gebruik")));
  const [notify, setNotify] = useState<keyof typeof NOTIFY_CHOICES>(detail?.notify?.to ?? "none");
  const [tagIds, setTagIds] = useState(detail?.tags.map((t) => t.id) ?? lists.find((l) => l.id === list)?.tags ?? []);
  const [fresh, setFresh] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { data: columns } = useApi<ListColumns[]>("/me/columns");
  const items = lists.filter((l) => l.one && !l.archived);
  // Foto lezen: null = de standaard (met geld of voedingswaarden), anders wat je koos.
  const [reads, setReads] = useState<boolean | null>(kind?.reads ?? null);
  const readsNow = formReads({ id: kind?.id ?? "", reads, parts, fields: kind?.fields ?? [] });

  /**
   * Geld aan of uit, naar iemand of gedeeld: het saldo volgt mee (wie betaalde telt bij, wie deelt of naar wie telt af),
   * tenzij je dat zelf al anders instelde.
   */
  function money(on: boolean, to: boolean) {
    setParts({ ...parts, money: on, to: on && to });
    const people = does.filter((h) => h.rows.from !== "lines");
    const ledger = people.find((h) => h.field === BALANCE)?.list ?? null;
    const standard = people.every((h) => h.field === BALANCE && h.list === ledger && h.value.from === "amount");
    if (!standard || !ledger) return;
    const rest = does.filter((h) => h.rows.from === "lines");
    setDoes(on ? [...rest, ...doesDraft(presetDoes(to ? "overdracht" : "dienst", ledger))] : rest);
  }
  function start(b: Base) {
    setBase(b);
    setParts(startParts(b));
    setDoes(doesDraft(presetDoes(b)));
  }
  async function save() {
    const built = buildFields(drafts, "self");
    if ("error" in built) return toast(built.error, "alert");
    // Een nieuw veld krijgt zijn sleutel pas nu: wat het formulier ermee invult, volgt mee.
    const keyOf = new Map(drafts.map((d, i) => [d.key, built.fields[i]?.key ?? d.key]));
    const groups = parts.groups.map((g) => ({ ...g, label: g.label.trim() || LINE_ROLES[g.role].label }));
    const body = {
      base,
      name,
      icon,
      fields: built.fields,
      parts: { ...parts, groups },
      does: buildDoes(does).map((h) => (h.value.from === "field" ? { ...h, value: { from: "field" as const, key: keyOf.get(h.value.key) ?? h.value.key } } : h)),
      goal: parts.duration && goal.trim() ? Math.round(Number(goal.replace(",", ".")) * 60) : null,
      planned,
      reads,
      notify: notify === "none" ? null : { to: notify },
    };
    setBusy(true);
    try {
      let id = kind?.id;
      if (id) {
        await api.put(`/forms/${id}`, body);
        await api.put(`/forms/${id}/tags`, { tag_ids: tagIds, new_tags: fresh });
      } else id = (await api.post<{ id: string }>("/forms", { ...body, tag_ids: tagIds, new_tags: fresh })).id;
      setFresh([]);
      toast(`${name} bewaard`);
      reloadMe();
      onSaved(id);
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    if (!kind || !detail) return;
    await api.put(`/forms/${kind.id}/archived`, { archived: !detail.archived });
    toast(detail.archived ? `${kind.name} terug uit het archief` : `${kind.name} gearchiveerd`);
    reloadMe();
    onSaved(kind.id);
  }
  async function remove() {
    if (
      !kind ||
      !(await confirm({
        title: `${kind.name} verwijderen?`,
        body: "Met zijn hele logboek, en wat dat in de lijsten invulde. Dat kan niet terug.",
        confirmLabel: "Verwijderen",
        danger: true,
      }))
    )
      return;
    await api.delete(`/forms/${kind.id}`);
    reloadMe();
    toast(`${kind.name} verwijderd`);
    navigate("/lijsten", { replace: true });
  }
  return (
    <>
      <section className="card form-section">
        {!kind && (
          <label className="field">
            <span className="label">Begin van</span>
            <select value={base} onChange={(e) => isBase(e.target.value) && start(e.target.value)}>
              {Object.entries(BASES).map(([k, b]) => (
                <option key={k} value={k} title={b.hint}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span className="label">Naam</span>
          <input value={name} maxLength={40} required placeholder="bv. Gegeten, Schilderwerk" onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span className="label">Icoon</span>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
      </section>
      <section className="card form-section">
        <div className="switch-list">
          <Switch checked={parts.money} onChange={(on) => money(on, false)} label="Met een bedrag" />
          {parts.money && <Switch checked={parts.to} onChange={(on) => money(true, on)} label="Naar iemand" />}
          <Switch checked={parts.duration} onChange={(on) => setParts({ ...parts, duration: on })} label="Met een einde" />
        </div>
        {parts.duration && (
          <label className="field">
            <span className="label">Melding na (uren)</span>
            <input inputMode="decimal" value={goal} placeholder="bv. 16" onChange={(e) => setGoal(e.target.value)} />
          </label>
        )}
        <GroupsEditor value={parts.groups} onChange={(groups) => setParts({ ...parts, groups })} lists={items} />
      </section>
      <section className="card form-section">
        <FieldsEditor value={drafts} onChange={setDrafts} lists={lists} selfLabel={name || "Dit formulier"} people={[]} meId={person.id} />
      </section>
      {columns && (
        <section className="card form-section">
          <DoesEditor value={does} onChange={setDoes} columns={columns} fields={drafts} parts={parts} />
        </section>
      )}
      <section className="card form-section">
        <div className="switch-list">
          <Switch checked={planned} onChange={setPlanned} label="Gepland" />
          <Switch checked={readsNow} onChange={setReads} label={<>Foto lezen met AI <AiMark /></>} />
        </div>
        <label className="field">
          <span className="label">Melding bij iets nieuws</span>
          <select value={notify} onChange={(e) => setNotify(e.target.value as keyof typeof NOTIFY_CHOICES)}>
            {Object.entries(NOTIFY_CHOICES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <TagChooser tags={tags} value={tagIds} onChange={setTagIds} fresh={fresh} onFresh={setFresh} />
      </section>
      <button type="button" className="btn btn-primary btn-lg" disabled={busy || !name.trim()} onClick={save}>
        Opslaan
      </button>
      {kind && detail && (
        <div className="btn-row" style={{ justifySelf: "start" }}>
          <button type="button" className="btn btn-ghost" onClick={archive}>
            <Icon name="archive" size={15} /> {detail.archived ? "Uit het archief" : "Archiveren"}
          </button>
          <button type="button" className="btn btn-danger-ghost" onClick={remove}>
            <Icon name="trash" size={15} /> Verwijderen
          </button>
        </div>
      )}
    </>
  );
}
