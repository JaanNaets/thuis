// Tags van een lijst of formulier kiezen: de gekozen als tags met ×, eronder een zoekveld met de andere tags; wat je
// typt en nog geen tag is, wordt "Nieuwe tag: …" (de server maakt ze bij het bewaren, of hergebruikt een tag met
// dezelfde naam). Zie STIJLBOEK.md → Tags en Kiezen.

import { useState } from "react";
import type { Tag } from "../../shared/model";
import { Icon } from "./Icon";
import { Combo } from "./ItemPicker";

/** Een nieuwe tag in de keuzes: wat je typt, als er nog geen tag zo heet. */
const NEW = "__nieuw";

export function TagChooser({
  tags,
  value,
  onChange,
  fresh,
  onFresh,
}: {
  tags: Tag[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** Nieuwe tags (namen) die bij het bewaren gemaakt worden. */
  fresh: string[];
  onFresh: (names: string[]) => void;
}) {
  const [text, setText] = useState("");
  const typed = text.trim();
  const same = (a: string, b: string) => a.toLocaleLowerCase("nl") === b.toLocaleLowerCase("nl");
  const known = typed && (tags.some((t) => same(t.name, typed)) || fresh.some((f) => same(f, typed)));
  const options = [
    ...tags.filter((t) => !value.includes(t.id)).map((t) => ({ id: t.id, name: t.name })),
    ...(typed && !known ? [{ id: NEW, name: `Nieuwe tag: ${typed}` }] : []),
  ];
  function pick(id: string) {
    setText("");
    if (id === NEW) return onFresh([...fresh, typed.slice(0, 40)]);
    if (!value.includes(id)) onChange([...value, id]);
  }
  const chosen = value.flatMap((id) => tags.filter((t) => t.id === id));
  return (
    <div className="field">
      <span className="label">Tags</span>
      <div className="search-multi">
        {(chosen.length > 0 || fresh.length > 0) && (
          <ul className="ref-chips">
            {chosen.map((t) => (
              <li key={t.id} className={`tag static ref-chip tone-${t.color ?? "butter"}`}>
                <span>{t.name}</span>
                <button type="button" aria-label={`${t.name} weghalen`} onClick={() => onChange(value.filter((v) => v !== t.id))}>
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
            {fresh.map((n) => (
              <li key={n} className="tag static ref-chip tone-butter">
                <span>{n}</span>
                <button type="button" aria-label={`${n} weghalen`} onClick={() => onFresh(fresh.filter((x) => x !== n))}>
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Combo<{ id: string; name: string }>
          label="Tag toevoegen"
          text={text}
          options={options}
          placeOf={() => ""}
          disabled={false}
          placeholder="Tag toevoegen…"
          onText={setText}
          onPick={(o) => pick(o.id)}
        />
      </div>
    </div>
  );
}
