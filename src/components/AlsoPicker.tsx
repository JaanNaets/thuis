// Ook uit: dezelfde lijst in andere projecten erbij kiezen (in een weergave of een grafiek; zie `alsoFits` in
// shared/views.ts). Enkel lijsten die je ziet en die bij deze passen; zijn er geen, dan toont het niets.

import { alsoFits, MAX_ALSO } from "../../shared/views";
import type { ItemType } from "../../shared/types";
import { useApi } from "../api";
import { Icon } from "./Icon";

type Visible = ItemType & { project_name: string };

export function AlsoPicker({ home, value, onChange }: { home: Pick<ItemType, "id" | "fields">; value: string[]; onChange: (ids: string[]) => void }) {
  const { data } = useApi<Visible[]>("/types");
  const fitting = (data ?? []).filter((l) => l.id !== home.id && (value.includes(l.id) || alsoFits(home.fields, l.fields)));
  if (!fitting.length) return null;
  return (
    <div className="field">
      <span className="label">Ook uit</span>
      <div className="tag-picker">
        {fitting.map((l) => {
          const on = value.includes(l.id);
          return (
            <button
              key={l.id}
              type="button"
              className="tag"
              aria-pressed={on}
              disabled={!on && value.length >= MAX_ALSO}
              onClick={() => onChange(on ? value.filter((x) => x !== l.id) : [...value, l.id])}
            >
              {on && <Icon name="check" size={13} />} {l.plural} · {l.project_name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
