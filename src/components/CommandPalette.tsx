import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flattenTree } from "../../shared/tree";
import type { ItemListItem, LoyaltyCard, PurchaseListItem } from "../../shared/types";
import { api } from "../api";
import { useNavigate } from "../router";
import { useTaxonomy } from "../taxonomy";
import { Icon, type IconName } from "./Icon";
import { MENU, SETTINGS } from "./Sidebar";

type Entry = { key: string; group: string; label: string; hint?: string; icon: IconName; to: string };

const ACTIONS: Entry[] = [
  ...MENU.map((m) => ({ key: m.to, group: "Ga naar", label: m.label, icon: m.icon, to: m.to })),
  { key: SETTINGS.to, group: "Ga naar", label: SETTINGS.label, icon: SETTINGS.icon, to: SETTINGS.to },
  { key: "new-purchase", group: "Nieuw", label: "Nieuwe aankoop", icon: "receipt", to: "/aankopen/nieuw" },
  { key: "new-item", group: "Nieuw", label: "Iets in voorraad zetten", icon: "package", to: "/voorraad/nieuw" },
  { key: "new-card", group: "Nieuw", label: "Nieuwe klantenkaart", icon: "card", to: "/kaarten/nieuw" },
];

/** Zonder zoekterm: enkel de vaste acties. Met zoekterm: hoogstens zoveel per groep. */
const PER_GROUP = 5;

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Zoekpalet (⌘K of het zoekveld in de zijbalk): springt naar een scherm, een aankoop, iets in voorraad,
 * een kaart, een verkoper of een plaats. Pijltjes kiezen, Enter opent, Escape sluit.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { data: taxonomy } = useTaxonomy();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [data, setData] = useState<{ items: ItemListItem[]; purchases: PurchaseListItem[]; cards: LoyaltyCard[] }>();
  const [highlight, setHighlight] = useState<{ top: number; height: number }>();

  // Vóór het meten hieronder openen, anders is het palet nog onzichtbaar en meet alles 0.
  useLayoutEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) {
      setQuery("");
      setActive(0);
      dialog.showModal();
      // Telkens vers ophalen: het palet is klein, de lijsten ook.
      Promise.all([api.get<ItemListItem[]>("/items"), api.get<PurchaseListItem[]>("/purchases"), api.get<LoyaltyCard[]>("/loyalty-cards")]).then(
        ([items, purchases, cards]) => setData({ items, purchases, cards }),
        () => {},
      );
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return ACTIONS;
    const match = (...texts: (string | null | undefined)[]) => texts.some((t) => t && normalize(t).includes(q));
    const groups: Entry[][] = [
      ACTIONS.filter((a) => match(a.label)),
      (data?.items ?? [])
        .filter((i) => match(i.name, i.brand, i.category_name))
        .map((i) => ({ key: `i${i.id}`, group: "Voorraad", label: i.name, hint: i.category_name ?? undefined, icon: "package", to: `/voorraad/${i.id}` })),
      (data?.purchases ?? [])
        .filter((p) => match(p.description, p.vendor_name, p.notes))
        .map((p) => ({ key: `p${p.id}`, group: "Aankopen", label: p.description, hint: p.vendor_name ?? undefined, icon: "receipt", to: `/aankopen/${p.id}` })),
      (data?.cards ?? []).filter((c) => match(c.name)).map((c) => ({ key: `c${c.id}`, group: "Kaarten", label: c.name, icon: "card", to: `/kaarten/${c.id}` })),
      (taxonomy?.vendors ?? [])
        .filter((v) => match(v.name))
        .map((v) => ({ key: `v${v.id}`, group: "Verkopers", label: v.name, hint: "aankopen", icon: "store", to: `/aankopen?verkoper=${v.id}` })),
      flattenTree(taxonomy?.locations ?? [])
        .filter((l) => match(l.path))
        .map((l) => ({ key: `l${l.id}`, group: "Plaatsen", label: l.path, hint: "voorraad", icon: "pin", to: `/voorraad?plaats=${l.id}` })),
    ];
    return groups.flatMap((g) => g.slice(0, PER_GROUP));
  }, [query, data, taxonomy]);

  const current = Math.min(active, results.length - 1);

  // Het grijze vlak schuift naar de gekozen regel, en die blijft in beeld.
  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el) return setHighlight(undefined);
    setHighlight({ top: el.offsetTop, height: el.offsetHeight });
    el.scrollIntoView({ block: "nearest" });
  }, [current, results, open]);

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    navigate(entry.to);
  };

  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label="Zoeken"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="palette-search">
        <Icon name="search" size={16} />
        <input
          autoFocus
          value={query}
          placeholder="Zoek een aankoop, iets in huis, een kaart…"
          aria-label="Zoeken"
          aria-controls="palette-list"
          aria-activedescendant={results[current] ? `palette-${results[current].key}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((current + 1) % Math.max(results.length, 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((current - 1 + results.length) % Math.max(results.length, 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(results[current]);
            }
          }}
        />
        <kbd>Esc</kbd>
      </div>

      <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
        {highlight && <span className="palette-highlight" style={{ "--top": `${highlight.top}px`, "--h": `${highlight.height}px` } as CSSProperties} />}
        {results.length === 0 && <p className="palette-empty">Niets gevonden voor “{query.trim()}”</p>}
        {results.map((entry, i) => (
          <div key={entry.key} className="palette-entry">
            {entry.group !== results[i - 1]?.group && <p className="palette-group">{entry.group}</p>}
            <div
              id={`palette-${entry.key}`}
              role="option"
              aria-selected={i === current}
              className="palette-option"
              onPointerMove={() => i !== current && setActive(i)}
              onClick={() => go(entry)}
            >
              <Icon name={entry.icon} size={16} />
              <span className="palette-label">{entry.label}</span>
              {entry.hint && <span className="palette-hint">{entry.hint}</span>}
              <Icon name="arrow" size={14} className="palette-go" />
            </div>
          </div>
        ))}
      </div>
    </dialog>
  );
}
