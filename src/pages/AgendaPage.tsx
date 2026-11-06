import { useSearchParams } from "react-router";
import { BASES, timeOf } from "../../shared/model";
import { useApi } from "../api";
import { CalendarMonth, gridRange, type CalendarEntry } from "../components/Calendar";
import type { IconName } from "../components/Icon";
import { BASE_TONES, usePageNames, type EventPage } from "../components/Log";
import { PageHead } from "../components/Page";
import { today } from "../format";

type Agenda = EventPage & { from: string; to: string; dated: { thing_id: string; name: string; list_id: string; label: string; start: string; end?: string }[] };

/**
 * De agenda over al je lijsten: wat gebeurde en gepland staat, en datums van dingen met "In de agenda" (de keuring,
 * een verjaardag, het einde van de garantie). De maand staat in het adres (?maand=2026-11).
 */
export function AgendaPage() {
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get("maand") ?? "") ? params.get("maand")! : today().slice(0, 7);
  const [from, to] = gridRange(month);
  const { data, error } = useApi<Agenda>(`/insights/agenda?from=${from}&to=${to}`);
  const names = usePageNames(data);
  const entries: CalendarEntry[] = [
    ...(data?.events ?? []).map((e) => ({
      key: e.id,
      title: names.title(e),
      start: e.at.slice(0, 10),
      href: `/gebeurtenissen/${e.id}`,
      tone: BASE_TONES[e.base],
      icon: (names.kind(e).icon ?? BASES[e.base].icon) as IconName,
      meta: [timeOf(e.at), names.list(e.list_id), e.status === "gepland" ? "gepland" : null].filter(Boolean).join(" · "),
    })),
    ...(data?.dated ?? []).map((d, i) => ({
      key: `${d.thing_id}-${i}`,
      title: d.name,
      start: d.start,
      end: d.end,
      href: `/dingen/${d.thing_id}`,
      tone: "sky",
      icon: "calendar" as IconName,
      meta: d.label,
    })),
  ];
  return (
    <div className="page">
      <PageHead title="Agenda" />
      {error && <p className="error">{error}</p>}
      <CalendarMonth month={month} onMonth={(m) => setParams({ maand: m }, { replace: true })} entries={entries} empty="Niets deze maand" />
    </div>
  );
}
