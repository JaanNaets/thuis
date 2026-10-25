import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "./Icon";

/**
 * Een kleine (i) met uitleg: verschijnt bij aanwijzen of focus, en bij tikken (gsm). Escape, ergens anders tikken of
 * scrollen sluit ze. De uitleg staat altijd in de toegankelijke beschrijving van de knop, ook als ze dicht is.
 */
export function Tip({ text, label = "Uitleg" }: { text: string; label?: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  // Geopend door aan te wijzen: een klik laat ze dan open (anders gaat ze meteen weer dicht).
  const byHover = useRef(false);

  // Plaatsen onder de knop (of erboven als er geen ruimte is), binnen het scherm.
  useLayoutEffect(() => {
    if (!open || !button.current || !bubble.current) return;
    const b = button.current.getBoundingClientRect();
    const t = bubble.current.getBoundingClientRect();
    const margin = 12;
    const left = Math.min(Math.max(margin, b.left + b.width / 2 - t.width / 2), window.innerWidth - t.width - margin);
    const below = b.bottom + 6;
    const top = below + t.height > window.innerHeight - margin ? b.top - t.height - 6 : below;
    setStyle({ left, top: Math.max(margin, top) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "pointerdown" && button.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const show = (hover = false) => {
    byHover.current = hover;
    setStyle({ visibility: "hidden" });
    setOpen(true);
  };
  return (
    <span className="tip">
      <button
        ref={button}
        type="button"
        className="tip-button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!open) show();
          else if (byHover.current) byHover.current = false;
          else setOpen(false);
        }}
        onPointerEnter={(e) => e.pointerType === "mouse" && !open && show(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
        onFocus={(e) => e.target.matches(":focus-visible") && show()}
        onBlur={() => setOpen(false)}
      >
        <Icon name="info" size={14} />
      </button>
      <span ref={bubble} id={id} role="tooltip" className="tip-bubble" hidden={!open} style={style}>
        {text}
      </span>
    </span>
  );
}
