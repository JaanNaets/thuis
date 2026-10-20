import { useState, type KeyboardEvent } from "react";
import { TONES, type Tag } from "../../shared/types";
import { api, ApiError } from "../api";
import { refreshTaxonomy } from "../taxonomy";
import { Icon } from "./Icon";

/** Tags aan- en uitvinken, of meteen een nieuwe maken. */
export function TagPicker({ tags, value, onChange }: { tags: Tag[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      if (!value.includes(existing.id)) onChange([...value, existing.id]);
      setName("");
      setAdding(false);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const tag = await api.post<Tag>("/tags", { name: trimmed, color: TONES[tags.length % TONES.length] });
      await refreshTaxonomy();
      onChange([...value, tag.id]);
      setName("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "De tag kon niet gemaakt worden.");
    } finally {
      setBusy(false);
    }
  }

  // Enter maakt de tag, in plaats van het hele formulier te versturen.
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      create();
    }
    if (e.key === "Escape") setAdding(false);
  }

  return (
    <div className="tag-picker">
      {tags.map((tag) => {
        const on = value.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            className={`tag-chip tone-${tag.color ?? "butter"} ${on ? "on" : ""}`}
            aria-pressed={on}
            onClick={() => toggle(tag.id)}
          >
            {on && <Icon name="check" size={14} />}
            {tag.name}
          </button>
        );
      })}
      {adding ? (
        <span className="tag-new">
          <input
            autoFocus
            maxLength={40}
            value={name}
            placeholder="Nieuwe tag"
            aria-label="Naam van de nieuwe tag"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="icon-button small" onClick={create} disabled={busy} aria-label="Tag toevoegen">
            <Icon name="check" size={18} />
          </button>
        </span>
      ) : (
        <button type="button" className="tag-chip add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Tag
        </button>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
