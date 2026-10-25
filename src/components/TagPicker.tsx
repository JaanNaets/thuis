import { useState, type KeyboardEvent } from "react";
import { TONES, type Tag } from "../../shared/types";
import { api, ApiError } from "../api";
import { Icon } from "./Icon";

/** Tags aan- en uitvinken, of meteen een nieuwe maken (in `projectId`). */
export function TagPicker({
  tags,
  value,
  onChange,
  projectId,
  onCreated,
}: {
  tags: Tag[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** Zonder project kan je geen nieuwe tag maken. */
  projectId?: string;
  onCreated?: (tag: Tag) => void;
}) {
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
      const tag = await api.post<Tag>(`/projects/${projectId}/tags`, { name: trimmed, color: TONES[tags.length % TONES.length] });
      onCreated?.(tag);
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
          <button key={tag.id} type="button" className={`tag tone-${tag.color ?? "butter"}`} aria-pressed={on} onClick={() => toggle(tag.id)}>
            <Icon name="check" size={14} className="check" />
            {!on && <span className="dot" />}
            {tag.name}
          </button>
        );
      })}
      {!projectId ? null : adding ? (
        <span className="tag-new">
          <input
            autoFocus
            maxLength={40}
            value={name}
            placeholder="Naam van de tag"
            aria-label="Naam van de nieuwe tag"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => !name.trim() && setAdding(false)}
          />
          <button type="button" className="btn btn-outline btn-icon btn-sm" onClick={create} disabled={busy} aria-label="Tag toevoegen">
            <Icon name="check" size={16} />
          </button>
        </span>
      ) : (
        <button type="button" className="tag add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Tag
        </button>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
