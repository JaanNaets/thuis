// Tags van een lijst kiezen: bestaande tags aan- en uitvinken, of een nieuwe naam typen (de server maakt ze bij het
// bewaren, of hergebruikt een tag met dezelfde naam). Zie STIJLBOEK.md → Tags.

import { useState, type KeyboardEvent } from "react";
import type { Tag } from "../../shared/model";
import { Icon } from "./Icon";

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
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  function add() {
    const trimmed = name.trim();
    if (!trimmed) return setAdding(false);
    const existing = tags.find((t) => t.name.toLocaleLowerCase("nl") === trimmed.toLocaleLowerCase("nl"));
    if (existing) {
      if (!value.includes(existing.id)) onChange([...value, existing.id]);
    } else if (!fresh.some((f) => f.toLocaleLowerCase("nl") === trimmed.toLocaleLowerCase("nl"))) onFresh([...fresh, trimmed]);
    setName("");
    setAdding(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
    if (e.key === "Escape") setAdding(false);
  }

  return (
    <div className="field">
      <span className="label">Tags</span>
      <div className="tag-picker">
        {tags.map((tag) => {
          const on = value.includes(tag.id);
          return (
            <button key={tag.id} type="button" className={`tag tone-${tag.color ?? "butter"}`} aria-pressed={on} onClick={() => toggle(tag.id)}>
              <Icon name="check" size={14} className="check" />
              {!on && <span className="dot" />}
              {tag.name}
            </button>
          );
        })}
        {fresh.map((n) => (
          <button key={n} type="button" className="tag tone-butter" aria-pressed onClick={() => onFresh(fresh.filter((x) => x !== n))}>
            <Icon name="check" size={14} className="check" />
            {n}
          </button>
        ))}
        {adding ? (
          <span className="tag-new">
            <input autoFocus maxLength={40} value={name} placeholder="Naam van de tag" aria-label="Naam van de nieuwe tag" onChange={(e) => setName(e.target.value)} onKeyDown={onKeyDown} onBlur={add} />
          </span>
        ) : (
          <button type="button" className="tag add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> Tag
          </button>
        )}
      </div>
    </div>
  );
}
