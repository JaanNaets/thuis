// Waarmee je logt bij een lijst of een item ervan (`logForms` in shared/targets.ts): een knop per formulier dat die lijst
// invult ("Uit eten", "Proeverij", "Aankoop"), op een item met dat item al ingevuld. Zo zie je wat je hier kan loggen,
// en is loggen één tik op wat er gebeurde. De gebeurtenis komt in het logboek van het formulier.

import { shownIn } from "../../shared/apps";
import { logForms, logPath, type Targets } from "../../shared/targets";
import { useApi } from "../api";
import { Link } from "../router";
import { useSession } from "../session";
import { Icon, type IconName } from "./Icon";

export function LogButtons({ listId, item, planned = false, row = false }: { listId: string; item?: string; planned?: boolean; row?: boolean }) {
  const { hidden } = useSession();
  const { data } = useApi<Targets>("/me/targets");
  if (!data) return null;
  const forms = logForms(data, listId, (id) => shownIn(hidden, "add", id));
  if (!forms.length) return null;
  const links = forms.map((f) => {
    // Zonder item (bovenaan het logboek): een nieuw item in een lijn komt in deze lijst.
    const path = logPath(f.kind, item, "", item ? undefined : listId);
    return (
      <Link key={f.key} to={planned ? `${path}&gepland=1` : path} className="btn btn-outline btn-sm">
        <Icon name={f.icon as IconName} size={14} /> {f.label}
      </Link>
    );
  });
  return row ? <div className="log-buttons">{links}</div> : <>{links}</>;
}
