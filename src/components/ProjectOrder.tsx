import { useEffect, useState } from "react";
import type { ProjectNode } from "../../shared/types";
import { api } from "../api";
import { useSession } from "../session";
import { Icon } from "./Icon";
import { projectIcon } from "./Sidebar";
import { useSortable } from "./Sortable";
import { useToast } from "./Toast";

/**
 * Projecten in volgorde slepen. Zonder `parent`: de projecten bovenaan je overzicht (jouw eigen volgorde). Met
 * `parent`: de subprojecten van dat project (voor iedereen; enkel wie het project instelt). Bewaart meteen.
 */
export function ProjectOrder({ nodes, parent, onChanged }: { nodes: ProjectNode[]; parent?: ProjectNode; onChanged?: () => void }) {
  const { reloadMe } = useSession();
  const toast = useToast();
  const sorted = nodes.map((n) => n.id);
  const key = sorted.join(",");
  const [order, setOrder] = useState(sorted);
  useEffect(() => setOrder(key ? key.split(",") : []), [key]);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  async function save(ids: string[]) {
    setOrder(ids);
    try {
      await api.put(parent ? `/projects/${parent.id}/children/order` : "/me/order", { ids });
      reloadMe();
      onChanged?.();
    } catch (err) {
      toast((err as Error).message, "alert");
      setOrder(sorted);
    }
  }
  const sortable = useSortable(order, save, (id) => byId.get(id)?.name ?? "");

  return (
    <>
      <ul className="sort-list">
        {order.map((id) => {
          const n = byId.get(id);
          if (!n) return null;
          return (
            <li key={id} {...sortable.itemProps(id)}>
              <div className="sort-row">
                <button {...sortable.handleProps(id)}>
                  <Icon name="grip" size={16} />
                </button>
                <span className={`row-media tone-${n.color ?? "sky"}`}>
                  <Icon name={projectIcon(n)} size={16} />
                </span>
                <span className="row-title">{n.name}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {sortable.status}
    </>
  );
}
