// Een formulier kiezen (zie `formsOf` in shared/model.ts): met een lijst de formulieren die haar invullen als pillen,
// de rest onder Ander formulier…. In het logformulier en bij een actie op een bord.

import { fillsLists, formsOf, type KindInfo } from "../../shared/model";
import { Icon, type IconName } from "./Icon";
import { SearchAdd } from "./SearchSelect";

export function FormPicker({ kinds, listId, value, onChange, wrap = false }: { kinds: KindInfo[]; listId?: string | null; value: string; onChange: (k: KindInfo) => void; wrap?: boolean }) {
  const { shown, more } = formsOf(kinds, (k) => Boolean(listId) && fillsLists(k).includes(listId!), value);
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
        <SearchAdd
          label="Ander formulier"
          placeholder="Ander formulier…"
          options={more.map((k) => ({ id: k.id, name: k.name }))}
          onPick={(id) => {
            const k = more.find((x) => x.id === id);
            if (k) onChange(k);
          }}
        />
      )}
    </div>
  );
}
