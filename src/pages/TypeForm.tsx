import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import type { IconKey } from "../../shared/templates";
import type { ItemType, ItemTypeInput, ProjectDetail } from "../../shared/types";
import { api, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { SubmitButton } from "../components/Controls";
import { buildFields, FieldsEditor, fieldsDraft, type FieldDraft } from "../components/Fields";
import { Icon } from "../components/Icon";
import { IconPicker } from "../components/IconPicker";
import { PageHead } from "../components/Page";
import { buildRules, ruleDraft, RulesEditor, type RuleDraft } from "../components/RulesEditor";
import { useToast } from "../components/Toast";
import { useNavigate } from "../router";
import { useSession } from "../session";

type FullType = ItemType & { project_name: string };

/** Een lijst samenstellen: naam, hoe één item heet, icoon, velden en wat de app ermee doet (de regel). */
export function TypeFormPage() {
  const { id, typeId } = useParams();
  const { data: p, error } = useApi<ProjectDetail>(`/projects/${id}`);
  // Alle lijsten met al hun velden (de projectfiche toont enkel wat jij mag zien).
  const { data: all, error: allError } = useApi<FullType[]>(`/projects/${id}/all-types`);
  if (error || allError) return <p className="error page">{error ?? allError}</p>;
  if (!p || !all) return null;
  const existing = typeId ? all.find((t) => t.id === typeId) : undefined;
  if (typeId && !existing) return <p className="error page">Die lijst bestaat niet (meer).</p>;
  // Verwijzen kan naar lijsten van dit project en erboven.
  const chain = new Set([p.project.id, ...p.path.map((x) => x.id)]);
  const refTypes = all.filter((t) => chain.has(t.project_id) && t.id !== typeId);
  return <TypeForm project={p} existing={existing} refTypes={refTypes} />;
}

function TypeForm({ project: p, existing, refTypes }: { project: ProjectDetail; existing?: FullType; refTypes: ItemType[] }) {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(existing?.name ?? "");
  const [plural, setPlural] = useState(existing?.plural ?? "");
  const [nameLabel, setNameLabel] = useState(existing?.name_label ?? "");
  const [icon, setIcon] = useState<IconKey | null>(existing?.icon ?? "folder");
  const [fields, setFields] = useState<FieldDraft[]>(() => fieldsDraft(existing?.fields ?? []));
  const [rule, setRule] = useState<RuleDraft>(() => ruleDraft(existing?.rules ?? []));
  const { person } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const back = `/projecten/${p.project.id}/instellingen?tab=lijsten`;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const built = buildFields(fields);
    if ("error" in built) return setError(built.error);
    const rules = buildRules(rule, fields, (key) => built.fields[fields.findIndex((f) => f.key === key)]?.key);
    if ("error" in rules) return setError(rules.error);
    const input: ItemTypeInput = { name, plural: plural || name, name_label: nameLabel || null, icon, fields: built.fields, rules: rules.rules };
    setBusy(true);
    setError(undefined);
    try {
      if (existing) await api.put(`/types/${existing.id}`, input);
      else await api.post(`/projects/${p.project.id}/types`, input);
      toast(existing ? `${input.plural} bijgewerkt` : `${input.plural} gemaakt`);
      navigate(back, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    const ok = await confirm({
      title: `${existing.plural} verwijderen?`,
      body: "Kan enkel als er geen items meer in deze lijst staan.",
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/types/${existing.id}`);
      toast("Lijst verwijderd", "trash");
      navigate(back, { replace: true });
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead title={existing ? existing.plural : "Nieuwe lijst"} description={p.project.name} back={{ to: -1, label: "Lijsten" }} />

      <section className="card form-section">
        <div className="field-row">
          <label className="field">
            <span className="label">Naam van de lijst</span>
            <input maxLength={40} value={plural} onChange={(e) => setPlural(e.target.value)} placeholder="bv. Wijnen" />
          </label>
          <label className="field">
            <span className="label">Eén item heet</span>
            <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Wijn" />
          </label>
        </div>
        <label className="field">
          <span className="label">
            Hoe heet de naam <span className="optional">· optioneel</span>
          </span>
          <input maxLength={40} value={nameLabel} onChange={(e) => setNameLabel(e.target.value)} placeholder="Naam" />
          <span className="hint">Elk item heeft een naam. Bij een uitgave is dat bv. "Omschrijving".</span>
        </label>
        <div className="field">
          <span className="label">Icoon</span>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
      </section>

      <section className="card form-section">
        <FieldsEditor value={fields} onChange={setFields} types={refTypes} selfLabel={plural || name || "Deze lijst"} selfId={existing?.id} />
      </section>

      <RulesEditor
        value={rule}
        onChange={setRule}
        fields={fields}
        onAddFields={(added) => setFields((f) => [...f, ...added])}
        people={p.members.map((m) => m.person)}
        meId={person.id}
      />

      {error && <p className="error">{error}</p>}
      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        {busy ? "Opslaan…" : "Opslaan"}
      </SubmitButton>
      {existing && (
        <button type="button" className="btn btn-danger-ghost" style={{ justifySelf: "start" }} onClick={remove}>
          <Icon name="trash" size={16} /> Lijst verwijderen
        </button>
      )}
    </form>
  );
}
