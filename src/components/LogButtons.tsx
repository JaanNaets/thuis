// Waarmee je logt bij een lijst of een ding ervan (`logForms` in shared/targets.ts): een knop per formulier ("Uit eten",
// "Proeverij", "Aankoop"), op een ding met dat ding al ingevuld. Zo zie je wat je hier kan loggen, en is loggen één tik
// op wat er gebeurde. De gebeurtenis komt in de lijst van het formulier (een aankoop in Uitgaven); de knop zegt waar.

import { shownIn } from "../../shared/apps";
import { logForms, logPath, type Targets } from "../../shared/targets";
import { useApi } from "../api";
import { Link } from "../router";
import { useSession } from "../session";
import { Icon, type IconName } from "./Icon";

export function LogButtons({ listId, thing, planned = false, row = false }: { listId: string; thing?: string; planned?: boolean; row?: boolean }) {
  const { hidden } = useSession();
  const { data } = useApi<Targets>("/me/targets");
  if (!data) return null;
  const forms = logForms(data, listId, (id) => shownIn(hidden, "add", id) || id === listId);
  if (!forms.length) return null;
  const links = forms.map((f) => {
    // Zonder ding (bovenaan het logboek): een nieuw ding in een lijn komt in deze lijst.
    const path = logPath(f, thing, "", thing ? undefined : listId);
    return (
      <Link key={f.key} to={planned ? `${path}${path.includes("?") ? "&" : "?"}gepland=1` : path} className="btn btn-outline btn-sm" aria-label={f.hint ? `${f.label} (in ${f.hint})` : undefined}>
        <Icon name={f.icon as IconName} size={14} /> {f.label}
      </Link>
    );
  });
  return row ? <div className="log-buttons">{links}</div> : <>{links}</>;
}
