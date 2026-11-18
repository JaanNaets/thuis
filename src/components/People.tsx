// Wie bij een lijst of een formulier is, en iemand toevoegen (Instellen → Mensen). Lijsten en formulieren hebben
// dezelfde rollen (shared/rights.ts) en dezelfde routes (worker/members.ts).

import { useEffect, useState } from "react";
import { ROLES, type DirectRole, type ListPerson } from "../../shared/model";
import type { Person } from "../../shared/types";
import { api, useApi } from "../api";
import { useSession } from "../session";
import { Avatar, CardHead } from "./Controls";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

/**
 * Wie bij een lijst of formulier is (`base`: /lists/:id of /forms/:id): rechtstreeks met een rol, via een tag, of een
 * uitzondering (Geen toegang); + Iemand voegt iemand toe. Enkel voor een beheerder.
 */
export function PeopleEditor({ base, people, onSaved }: { base: string; people: ListPerson[]; onSaved: () => void }) {
  const { person: me } = useSession();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  async function setRole(p: ListPerson, role: DirectRole | null) {
    try {
      await api.put(`${base}/people/${p.person.id}`, { role });
      toast(role === null ? `${p.person.name} weggehaald` : `${p.person.name}: ${role === "geen" ? "geen toegang" : ROLES[role].label.toLowerCase()}`);
      onSaved();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  return (
    <>
      <section className="card">
        <CardHead
          title="Wie"
          action={
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(true)}>
              <Icon name="plus" size={15} /> Iemand
            </button>
          }
        />
        <ul className="rows">
          {people.map((p) => (
            <li key={p.person.id}>
              <div className="row">
                <span className="cell-main">
                  <Avatar member={p.person} />
                  <span className="row-main">
                    <span className="row-title">{p.person.id === me.id ? `${p.person.name} (jij)` : p.person.name}</span>
                    <span className="row-meta">
                      <span>{p.direct === "geen" ? "Geen toegang (uitzondering)" : p.via ? `Via ${p.via.tag}` : ROLES[p.role].label}</span>
                    </span>
                  </span>
                </span>
                <span className="member-actions">
                  <select className="scope-select" aria-label={`Rol van ${p.person.name}`} value={p.direct ?? ""} onChange={(e) => setRole(p, (e.target.value || null) as DirectRole | null)}>
                    {p.via && (
                      <option value="">
                        Via {p.via.tag} ({ROLES[p.role].label.toLowerCase()})
                      </option>
                    )}
                    {!p.via && !p.direct && <option value="">—</option>}
                    {Object.entries(ROLES).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r.label}
                      </option>
                    ))}
                    <option value="geen">Geen toegang</option>
                  </select>
                  {p.direct && !p.via && (
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${p.person.name} weghalen`} onClick={() => setRole(p, null)}>
                      <Icon name="close" size={15} />
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <Sheet open={adding} title="Iemand toevoegen" onClose={() => setAdding(false)}>
        {adding && (
          <AddPerson
            base={base}
            onDone={() => {
              setAdding(false);
              onSaved();
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function AddPerson({ base, onDone }: { base: string; onDone: () => void }) {
  const toast = useToast();
  const { data: known } = useApi<Person[]>("/me/people");
  const [personId, setPersonId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"beheerder" | "lid" | "gast">("lid");
  useEffect(() => setPersonId(""), [known]);
  async function save() {
    try {
      await api.post(`${base}/people`, personId ? { person_id: personId, role } : { name, email: email || null, role });
      toast("Toegevoegd");
      onDone();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  return (
    <div className="form">
      {(known ?? []).length > 1 && (
        <label className="field">
          <span className="label">Iemand die je kent</span>
          <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">Iemand nieuw</option>
            {(known ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!personId && (
        <>
          <label className="field">
            <span className="label">Naam</span>
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">E-mailadres</span>
            <input type="email" value={email} placeholder="Om zelf aan te melden" onChange={(e) => setEmail(e.target.value)} />
          </label>
        </>
      )}
      <label className="field">
        <span className="label">Rol</span>
        <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          {Object.entries(ROLES).map(([k, r]) => (
            <option key={k} value={k}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn-primary" disabled={!personId && !name.trim()} onClick={save}>
        Toevoegen
      </button>
    </div>
  );
}

/** Wie bij een lijst of formulier kan: rechtstreeks met een rol, of via een tag (enkel als het meer is dan jij). */
export function PeopleCard({ people: all }: { people: ListPerson[] }) {
  const { person: me } = useSession();
  const people = all.filter((p) => p.direct !== "geen");
  if (people.length <= 1 && people[0]?.person.id === me.id) return null;
  return (
    <section className="card">
      <CardHead title="Wie" />
      <ul className="rows">
        {people.map((p) => (
          <li key={p.person.id}>
            <div className="row">
              <span className="cell-main">
                <Avatar member={p.person} />
                <span className="row-main">
                  <span className="row-title">{p.person.id === me.id ? `${p.person.name} (jij)` : p.person.name}</span>
                  <span className="row-meta">
                    <span>{p.via ? `${ROLES[p.role].label} · via ${p.via.tag}` : ROLES[p.role].label}</span>
                  </span>
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
