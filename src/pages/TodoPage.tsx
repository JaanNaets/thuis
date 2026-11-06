import type { EventView } from "../../shared/model";
import { api, useApi } from "../api";
import { LogList, type EventPage } from "../components/Log";
import { SkeletonRows } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { useToast } from "../components/Toast";

/**
 * Te doen: alles wat gepland staat in je lijsten (boodschappen, taken, afspraken), het vroegste eerst. Een boodschap
 * afvinken telt niet (dat doet de aankoop); een taak afvinken is ze gedaan. Een aankoop vinkt boodschappen vanzelf af.
 */
export function TodoPage() {
  const { data, error, reload } = useApi<EventPage>("/insights/todo");
  const toast = useToast();
  async function tick(e: EventView) {
    try {
      await api.post(`/events/${e.id}/tick`, e.status === "gepland" ? {} : { undo: true });
      toast(e.base === "aankoop" ? "Afgevinkt" : "Gedaan");
      reload();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  return (
    <div className="page">
      <PageHead title="Te doen" />
      {error && <p className="error">{error}</p>}
      {!data && <SkeletonRows rows={5} />}
      {data && !data.events.length && <EmptyState icon="check" title="Niets te doen" />}
      {data && data.events.length > 0 && <LogList page={data} onTick={tick} />}
    </div>
  );
}
