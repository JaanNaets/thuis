import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { moveItem } from "../../shared/order";

type Drag = {
  id: string;
  from: number;
  to: number;
  /** Waar de vinger begon, en hoe ver de rij nu verschoven is. */
  startY: number;
  dy: number;
  /** Midden van elke rij bij de start (in de volgorde van ids). */
  mids: number[];
  /** Hoeveel de andere rijen opzij schuiven: de hoogte van de gesleepte rij plus de ruimte ertussen. */
  size: number;
  scroller: HTMLElement;
  startScroll: number;
};

/** Het element dat scrolt (het paneel op tablet, de pagina op gsm). */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement as HTMLElement;
}

function viewportOf(el: HTMLElement): { top: number; bottom: number } {
  if (el === document.scrollingElement) return { top: 0, bottom: window.innerHeight };
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom };
}

/**
 * Een lijst herschikken: slepen aan een greep (muis of vinger), of met de pijltjes op de greep (toetsenbord). De
 * gesleepte rij volgt de vinger, de andere schuiven opzij; dicht bij de rand scrolt de lijst mee.
 *
 * De ouder houdt de volgorde bij: `onReorder` krijgt de nieuwe volgorde en zet ze meteen (daarna pas bewaren),
 * anders springt de rij even terug. Zet `itemProps(id)` op elke rij en `handleProps(id)` op een `<button>` erin,
 * en toon `status` ergens in de buurt (voor schermlezers).
 */
export function useSortable(ids: string[], onReorder: (ids: string[]) => void, labelOf: (id: string) => string) {
  const items = useRef(new Map<string, HTMLElement>());
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [settling, setSettling] = useState(false);
  const [message, setMessage] = useState("");
  const focusAfter = useRef<string | null>(null);
  const pointerY = useRef(0);
  const frame = useRef(0);
  const hintId = useId();

  // Na een verplaatsing met de pijltjes blijft de focus op dezelfde greep.
  useLayoutEffect(() => {
    if (!focusAfter.current) return;
    items.current.get(focusAfter.current)?.querySelector<HTMLElement>("[data-drag-handle]")?.focus();
    focusAfter.current = null;
  }, [ids]);

  // Na het loslaten één beeld zonder overgang: de rij staat meteen op haar nieuwe plaats, niets schuift terug.
  useEffect(() => {
    if (!settling) return;
    const r = requestAnimationFrame(() => setSettling(false));
    return () => cancelAnimationFrame(r);
  }, [settling]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const announce = (id: string, to: number) => setMessage(`${labelOf(id)}: plaats ${to + 1} van ${ids.length}`);

  function follow(d: Drag, clientY: number) {
    const dy = clientY - d.startY + (d.scroller.scrollTop - d.startScroll);
    const center = d.mids[d.from] + dy;
    const to = d.mids.filter((m, i) => i !== d.from && m < center).length;
    const next = { ...d, dy, to };
    dragRef.current = next;
    setDrag(next);
  }

  function autoScroll() {
    const d = dragRef.current;
    if (!d) return;
    const { top, bottom } = viewportOf(d.scroller);
    const y = pointerY.current;
    const speed = y < top + 64 ? -Math.ceil((top + 64 - y) / 5) : y > bottom - 64 ? Math.ceil((y - bottom + 64) / 5) : 0;
    if (speed) {
      d.scroller.scrollTop += speed;
      follow(d, y);
    }
    frame.current = requestAnimationFrame(autoScroll);
  }

  function start(e: PointerEvent<HTMLElement>, id: string) {
    const from = ids.indexOf(id);
    const el = items.current.get(id);
    if (e.button !== 0 || from < 0 || !el || ids.some((i) => !items.current.has(i))) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rects = ids.map((i) => items.current.get(i)!.getBoundingClientRect());
    const neighbour = rects[from + 1] ?? rects[from - 1];
    const gap = neighbour ? Math.max(0, neighbour.top > rects[from].top ? neighbour.top - rects[from].bottom : rects[from].top - neighbour.bottom) : 0;
    const scroller = scrollParent(el);
    const d: Drag = {
      id,
      from,
      to: from,
      startY: e.clientY,
      dy: 0,
      mids: rects.map((r) => r.top + r.height / 2),
      size: rects[from].height + gap,
      scroller,
      startScroll: scroller.scrollTop,
    };
    pointerY.current = e.clientY;
    dragRef.current = d;
    setDrag(d);
    frame.current = requestAnimationFrame(autoScroll);
  }

  function end(commit: boolean) {
    cancelAnimationFrame(frame.current);
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    setSettling(true);
    setDrag(null);
    if (commit && d.to !== d.from) {
      onReorder(moveItem(ids, d.from, d.to));
      announce(d.id, d.to);
    }
  }

  function key(e: KeyboardEvent<HTMLElement>, id: string) {
    if (e.key === "Escape" && dragRef.current) return end(false);
    const from = ids.indexOf(id);
    const to = { ArrowUp: from - 1, ArrowDown: from + 1, Home: 0, End: ids.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    if (to < 0 || to >= ids.length || to === from) return;
    focusAfter.current = id;
    onReorder(moveItem(ids, from, to));
    announce(id, to);
  }

  function itemProps(id: string) {
    const i = ids.indexOf(id);
    let y = 0;
    if (drag) {
      if (id === drag.id) y = drag.dy;
      else if (drag.from < drag.to && i > drag.from && i <= drag.to) y = -drag.size;
      else if (drag.from > drag.to && i >= drag.to && i < drag.from) y = drag.size;
    }
    return {
      ref: (el: HTMLElement | null) => {
        if (el) items.current.set(id, el);
        else items.current.delete(id);
      },
      "data-sorting": drag ? (id === drag.id ? "drag" : "shift") : settling ? "settle" : undefined,
      style: y ? ({ transform: `translateY(${y}px)` } as CSSProperties) : undefined,
    };
  }

  function handleProps(id: string) {
    return {
      type: "button" as const,
      className: "drag-handle",
      "data-drag-handle": "",
      "aria-label": `${labelOf(id)} verplaatsen`,
      "aria-describedby": hintId,
      onPointerDown: (e: PointerEvent<HTMLElement>) => start(e, id),
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const d = dragRef.current;
        if (!d || d.id !== id) return;
        pointerY.current = e.clientY;
        follow(d, e.clientY);
      },
      onPointerUp: () => end(true),
      onPointerCancel: () => end(false),
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => key(e, id),
    };
  }

  const status = (
    <>
      <span id={hintId} hidden>
        Sleep, of gebruik de pijltjes omhoog en omlaag.
      </span>
      <span className="sr-only" role="status">
        {message}
      </span>
    </>
  );

  return { itemProps, handleProps, status, dragging: drag !== null };
}
