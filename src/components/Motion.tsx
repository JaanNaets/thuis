import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "./Icon";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Vertraging per rij in een lijst (zie `.stagger` in de CSS). */
export function stagger(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

/**
 * Een getal dat bij elke wijziging omhoog of omlaag in beeld rolt.
 * Bij het eerste tonen beweegt er niets: enkel veranderingen krijgen aandacht.
 */
export function Num({ value, children }: { value: number; children?: string }) {
  const previous = useRef<number | undefined>(undefined);
  const direction = previous.current === undefined || previous.current === value ? "" : value > previous.current ? "up" : "down";
  useEffect(() => {
    previous.current = value;
  }, [value]);
  return (
    <span className="num">
      <span key={value} className={direction}>
        {children ?? value}
      </span>
    </span>
  );
}

/** Telt zacht op naar een bedrag (bv. het maandtotaal). */
export function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = useState(target);
  const from = useRef(0);

  useEffect(() => {
    if (reducedMotion()) {
      setValue(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 4);
      setValue(Math.round(begin + (target - begin) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    });
    return () => {
      cancelAnimationFrame(frame);
      from.current = target;
    };
  }, [target, ms]);

  return value;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Icon name="loader" size={size} className="spinner" />;
}

/** Grijze rijen die zacht glanzen terwijl een lijst laadt. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card skeleton-rows" aria-hidden="true">
      <ul className="rows">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i}>
            <div className="row">
              <span className="row-media skeleton" style={{ border: 0 }} />
              <span className="row-main" style={{ gap: 8 }}>
                <span className="skeleton" style={{ height: 12, width: `${55 + ((i * 17) % 30)}%` }} />
                <span className="skeleton" style={{ height: 10, width: `${30 + ((i * 11) % 20)}%` }} />
              </span>
              <span className="skeleton" style={{ height: 12, width: 52 }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
