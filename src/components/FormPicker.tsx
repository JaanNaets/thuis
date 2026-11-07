// Een formulier kiezen (een soort, zie `formsOf` in shared/model.ts): de formulieren van de lijst als pillen, de rest
// (de basissoorten naast eigen formulieren, de formulieren van andere lijsten) onder Ander formulier…. In het
// logformulier en bij een actie op een bord.

import { formsOf, type KindInfo } from "../../shared/model";
import { Icon, type IconName } from "./Icon";

export function FormPicker({ kinds, listId, value, onChange, wrap = false }: { kinds: KindInfo[]; listId: string; value: string; onChange: (k: KindInfo) => void; wrap?: boolean }) {
  const { shown, more } = formsOf(kinds, listId, value);
  return (
    <div className="field">
      <span className="label">Formulier</span>
      <div className={`filters${wrap ? " builder-chips" : ""}`} role="group" aria-label="Formulier">
        {shown.map((k) => (
          <button key={k.id} type="button" className="filter" aria-pressed={k.id === value} onClick={() => onChange(k)}>
            <Icon name={k.icon as IconName} size={14} /> {k.name}
          </button>
        ))}
      </div>
      {more.length > 0 && (
        <select
          aria-label="Ander formulier"
          value=""
          onChange={(e) => {
            const k = more.find((x) => x.id === e.target.value);
            if (k) onChange(k);
          }}
        >
          <option value="">Ander formulier…</option>
          {more.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
