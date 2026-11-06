import { useState } from "react";
import type { Nutrition } from "../../shared/food";
import type { Person } from "../../shared/types";
import { useApi } from "../api";
import { Avatar, CardHead, Segmented } from "../components/Controls";
import { dayLabel, LogList, type EventPage } from "../components/Log";
import { SkeletonRows } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { formatTotal, today } from "../format";
import { useSession } from "../session";

type Food = EventPage & { from: string; to: string; days: { day: string; people: Record<string, Nutrition> }[]; eaters: Person[] };

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Eten: kcal (en eiwitten, koolhydraten, vetten) per dag en per persoon, uit wat er gegeten werd: zelf ingevuld, of
 * uitgerekend uit de dingen die eraf gingen en hun productinfo. Wie at, staat in de verdeling.
 */
export function FoodPage() {
  const { person } = useSession();
  const [days, setDays] = useState<"7" | "30">("7");
  const t = today();
  const { data, error } = useApi<Food>(`/insights/food?from=${addDays(t, -(Number(days) - 1))}&to=${t}`);
  const name = (id: string) => (id === person.id ? "Jij" : (data?.eaters.find((p) => p.id === id)?.name ?? "Iemand"));
  return (
    <div className="page">
      <PageHead title="Eten" />
      <Segmented
        label="Periode"
        value={days}
        onChange={setDays}
        options={[
          { value: "7", label: "7 dagen" },
          { value: "30", label: "30 dagen" },
        ]}
      />
      {error && <p className="error">{error}</p>}
      {!data && <SkeletonRows rows={4} />}
      {data && !data.days.length && <EmptyState icon="food" title="Nog niets gegeten" />}
      {data && data.days.length > 0 && (
        <div className="split split-main-first">
          <aside className="split-aside">
            {data.days.map((d) => (
              <section key={d.day} className="card">
                <CardHead title={dayLabel(d.day)} />
                <ul className="rows">
                  {Object.entries(d.people).map(([id, n]) => (
                    <li key={id} className="row">
                      <span className="cell-main">
                        <Avatar member={data.eaters.find((p) => p.id === id)} />
                        <span className="row-main">
                          <span className="row-title">{name(id)}</span>
                          <span className="row-meta">
                            <span>
                              {[n.protein !== undefined && `${formatTotal(n.protein)} g eiwit`, n.carbs !== undefined && `${formatTotal(n.carbs)} g koolh.`, n.fat !== undefined && `${formatTotal(n.fat)} g vet`]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                        </span>
                      </span>
                      <span className="row-end">{formatTotal(n.kcal ?? 0)} kcal</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </aside>
          <div className="split-main">
            <LogList page={data} />
          </div>
        </div>
      )}
    </div>
  );
}
