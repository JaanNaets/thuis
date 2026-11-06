import { useState } from "react";
import { useParams } from "react-router";
import {
  ROLES,
  type ListNode,
  type Role,
  type Tag,
  type TagRule,
} from "../../shared/model";
import type { Person, Tone } from "../../shared/types";
import { api, useApi } from "../api";
import { CardHead, ToneSwatches } from "../components/Controls";
import { Icon } from "../components/Icon";
import { stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { listIcon, listTone } from "../lists";
import { Link, useNavigate } from "../router";
import { useSession } from "../session";

type TagDetail = {
  tag: Tag;
  lists: ListNode[];
  rules: TagRule[];
  people: Person[];
  can_edit: boolean;
};

/**
 * Een tag: de lijsten ermee, en de regels (wie altijd bij die lijsten kan). Een regel geldt enkel op lijsten waar wie
 * ze bewaarde rechtstreeks beheerder is; wat rechtstreeks bij een lijst staat, wint.
 */
export function TagPage() {
  const { tagId } = useParams();
  const { data, error, reload } = useApi<TagDetail>(`/tags/${tagId}`);
  const { person, reloadMe } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<"tag" | "rules" | null>(null);
  if (error && !data) return <p className="error page">{error}</p>;
  if (!data) return <p className="page muted">Laden…</p>;
  const name = (id: string) =>
    data.people.find((p) => p.id === id)?.name ?? "Iemand";

  async function remove() {
    if (
      !(await confirm({
        title: `${data!.tag.name} weghalen?`,
        body: "De lijsten blijven; de regels van deze tag vallen weg.",
        confirmLabel: "Weghalen",
        danger: true,
      }))
    )
      return;
    await api.delete(`/tags/${data!.tag.id}`);
    reloadMe();
    toast(`${data!.tag.name} weggehaald`);
    navigate("/", { replace: true });
  }

  return (
    <div className="page">
      <PageHead
        title={data.tag.name}
        actions={
          data.can_edit && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setEditing("tag")}
            >
              Bewerken
            </button>
          )
        }
        primary={
          <Link
            to={`/lijsten/nieuw?tag=${data.tag.id}`}
            className="btn btn-primary"
          >
            <Icon name="plus" size={16} /> Lijst
          </Link>
        }
      />
      <div className="split split-main-first">
        <aside className="split-aside">
          <section className="card">
            <CardHead
              title="Altijd erbij"
              action={
                data.can_edit && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setEditing("rules")}
                  >
                    Aanpassen
                  </button>
                )
              }
            />
            {data.rules.length === 0 ? (
              <p className="card-body muted">Niemand</p>
            ) : (
              <ul className="rows">
                {data.rules.map((r) => (
                  <li key={r.person_id}>
                    <div className="row">
                      <span className="cell-main">
                        <span className="row-main">
                          <span className="row-title">{name(r.person_id)}</span>
                          <span className="row-meta">
                            <span>
                              {ROLES[r.role].label}
                              {r.created_by !== person.id
                                ? ` · van ${name(r.created_by)}`
                                : ""}
                            </span>
                          </span>
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
        <div className="split-main">
          {data.lists.length === 0 ? (
            <EmptyState icon="tag" title="Nog geen lijsten" />
          ) : (
            <div className="card">
              <ul className="rows stagger">
                {data.lists.map((l, i) => (
                  <li key={l.id} style={stagger(i)}>
                    <Link to={`/lijsten/${l.id}`} className="row">
                      <span className="cell-main">
                        <span className={`row-media tone-${listTone(l)}`}>
                          <Icon name={listIcon(l)} size={17} />
                        </span>
                        <span className="row-main">
                          <span className="row-title">{l.name}</span>
                          <span className="row-meta">
                            <span>{ROLES[l.role].label}</span>
                          </span>
                        </span>
                      </span>
                      <Icon name="next" size={16} className="row-chevron" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.can_edit && data.tag.created_by === person.id && (
            <div className="btn-row" style={{ justifySelf: "start" }}>
              <button
                type="button"
                className="btn btn-danger-ghost btn-sm"
                onClick={remove}
              >
                <Icon name="trash" size={15} /> Tag weghalen
              </button>
            </div>
          )}
        </div>
      </div>
      <Sheet
        open={editing === "tag"}
        title={data.tag.name}
        onClose={() => setEditing(null)}
      >
        {editing === "tag" && (
          <TagForm
            tag={data.tag}
            onDone={() => {
              setEditing(null);
              reload();
              reloadMe();
            }}
          />
        )}
      </Sheet>
      <Sheet
        open={editing === "rules"}
        title="Altijd erbij"
        onClose={() => setEditing(null)}
      >
        {editing === "rules" && (
          <RulesForm
            tag={data.tag}
            rules={data.rules}
            onDone={() => {
              setEditing(null);
              reload();
              reloadMe();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function TagForm({ tag, onDone }: { tag: Tag; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<Tone | null>(tag.color);
  async function save() {
    try {
      await api.put(`/tags/${tag.id}`, { name, color });
      toast("Bewaard");
      onDone();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  return (
    <div className="form">
      <label className="field">
        <span className="label">Naam</span>
        <input
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="field">
        <span className="label">Kleur</span>
        <ToneSwatches value={color} onChange={setColor} />
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!name.trim()}
        onClick={save}
      >
        Opslaan
      </button>
    </div>
  );
}

/** Wie altijd bij de lijsten met deze tag kan, en als wat. */
function RulesForm({
  tag,
  rules,
  onDone,
}: {
  tag: Tag;
  rules: TagRule[];
  onDone: () => void;
}) {
  const toast = useToast();
  const { person } = useSession();
  const { data: known } = useApi<Person[]>("/me/people");
  const [rows, setRows] = useState<{ person_id: string; role: Role }[]>(
    rules.map((r) => ({ person_id: r.person_id, role: r.role })),
  );
  const others = (known ?? []).filter(
    (p) => p.id !== person.id && !rows.some((r) => r.person_id === p.id),
  );
  async function save() {
    try {
      await api.put(`/tags/${tag.id}/rules`, { rules: rows });
      toast("Bewaard");
      onDone();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  return (
    <div className="form">
      <ul className="rows">
        {rows.map((r, i) => (
          <li key={r.person_id}>
            <div className="row">
              <span className="cell-main">
                <span className="row-title">
                  {known?.find((p) => p.id === r.person_id)?.name ?? "Iemand"}
                </span>
              </span>
              <span className="member-actions">
                <select
                  className="scope-select"
                  aria-label={`Rol van ${known?.find((p) => p.id === r.person_id)?.name ?? "iemand"}`}
                  value={r.role}
                  onChange={(e) =>
                    setRows(
                      rows.map((x, k) =>
                        k === i ? { ...x, role: e.target.value as Role } : x,
                      ),
                    )
                  }
                >
                  {Object.entries(ROLES).map(([k, role]) => (
                    <option key={k} value={k}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label="Weghalen"
                  onClick={() => setRows(rows.filter((_, k) => k !== i))}
                >
                  <Icon name="close" size={15} />
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <select
          aria-label="Iemand toevoegen"
          value=""
          onChange={(e) =>
            e.target.value &&
            setRows([...rows, { person_id: e.target.value, role: "lid" }])
          }
        >
          <option value="">Iemand toevoegen…</option>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <button type="button" className="btn btn-primary" onClick={save}>
        Opslaan
      </button>
    </div>
  );
}
