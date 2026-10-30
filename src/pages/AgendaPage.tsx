import { useSearchParams } from "react-router";
import type { Agenda } from "../../shared/agenda";
import { useApi } from "../api";
import { CalendarMonth, gridRange, type CalendarEntry } from "../components/Calendar";
import { FilterSelect } from "../components/Controls";
import type { IconName } from "../components/Icon";
import { PageHead } from "../components/Page";
import { today } from "../format";
import { useSession } from "../session";

/**
 * De agenda over al je projecten: elk veld met "In de agenda" (een taak tegen, het volgende onderhoud, een maaltijd,
 * een verjaardag, een reis). De maand staat in de URL (?maand=2026-11), zodat terug ook terug naar die maand is.
 */
export function AgendaPage() {
  const { projects } = useSession();
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get("maand") ?? "") ? params.get("maand")! : today().slice(0, 7);
  const project = params.get("project");
  const [from, to] = gridRange(month);
  const { data, error } = useApi<Agenda>(`/agenda?from=${from}&to=${to}${project ? `&project=${project}` : ""}`);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  };

  const projectOf = new Map(data?.projects.map((p) => [p.id, p]));
  const typeOf = new Map(data?.types.map((t) => [t.id, t]));
  const several = (data?.projects.length ?? 0) > 1;
  const entries: CalendarEntry[] = (data?.entries ?? []).map((e, i) => {
    const p = projectOf.get(e.project_id);
    const t = typeOf.get(e.type_id);
    return {
      key: `${e.item_id}-${e.label}-${i}`,
      title: e.name,
      start: e.start,
      end: e.end,
      href: `/items/${e.item_id}`,
      tone: p?.color ?? "sky",
      icon: (t?.icon ?? "calendar") as IconName,
      meta: [t?.plural, e.label, several ? p?.name : undefined].filter(Boolean).join(" · "),
    };
  });

  return (
    <div className="page">
      <PageHead title="Agenda" description="Wat op een dag valt, uit al je projecten" />
      <div className="filters">
        <FilterSelect
          label="Project"
          all="Alle"
          value={project}
          onChange={(v) => set({ project: v })}
          options={projects.filter((p) => !p.archived).map((p) => ({ value: p.id, label: p.name }))}
        />
      </div>
      {error && <p className="error">{error}</p>}
      <CalendarMonth
        month={month}
        onMonth={(m) => set({ maand: m })}
        entries={entries}
        empty="Nog niets in de agenda. Zet bij een datum in een lijst 'In de agenda' aan (Instellen → de lijst → het veld → ⋯), of begin met een sjabloon met een agenda (Maaltijdplan, Taken, Onderhoud)."
      />
    </div>
  );
}
