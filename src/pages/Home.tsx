import { useState } from "react";
import { blockKey, defaultBlocks, type Block } from "../../shared/overview";
import type { Overview } from "../../shared/types";
import { api, useApi } from "../api";
import { Icon } from "../components/Icon";
import { BlocksEditor, BlockView } from "../components/OverviewBlocks";
import { EmptyState, PageHead } from "../components/Page";
import { projectIcon } from "../components/Sidebar";
import { useToast } from "../components/Toast";
import { projectTree } from "../projects";
import { Link } from "../router";
import { useSession } from "../session";

/**
 * Je overzicht: de blokken die je koos (zie shared/overview.ts), of vanzelf elk project met zijn lijsten. Met
 * Aanpassen schik je ze, verberg je lijsten en voeg je een lijst, snel toevoegen, een totaal of een waarde toe; Klaar
 * bewaart (enkel voor jou). De volgorde van je projecten in de boom zet je bij Jouw gegevens.
 */
export function Home() {
  const { projects } = useSession();
  const toast = useToast();
  const { data: overview, mutate } = useApi<Overview>("/me/overview");
  const tree = projectTree(projects, true);
  const active = tree.filter((p) => !p.archived);
  const archived = tree.filter((p) => p.archived);
  const lists = new Map(overview?.projects.map((p) => [p.id, p.types]));
  const [editing, setEditing] = useState<Block[] | null>(null);
  const [busy, setBusy] = useState(false);
  const blocks = editing ?? overview?.blocks ?? defaultBlocks(active.map((p) => p.id));

  async function save(next: Block[] | null) {
    setBusy(true);
    try {
      const { blocks: saved } = await api.put<{ blocks: Block[] | null }>("/me/overview", { blocks: next });
      if (overview) mutate({ ...overview, blocks: saved });
      setEditing(null);
      toast("Overzicht bewaard");
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHead
        title="Overzicht"
        actions={
          active.length > 0 &&
          overview &&
          (editing ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(null)}>
              Standaard
            </button>
          ) : (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(blocks)}>
              <Icon name="sliders" size={15} /> Aanpassen
            </button>
          ))
        }
        primary={
          !editing && (
            <Link to="/projecten/nieuw" className="btn btn-primary">
              <Icon name="plus" size={16} /> Nieuw project
            </Link>
          )
        }
      />

      {active.length === 0 ? (
        <EmptyState
          icon="project"
          title="Nog geen projecten"
          action={
            <Link to="/projecten/nieuw" className="btn btn-outline btn-sm">
              <Icon name="plus" size={16} /> Eerste project
            </Link>
          }
        />
      ) : editing && overview ? (
        <div className="form">
          <BlocksEditor blocks={editing} onChange={setEditing} overview={overview} />
          <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => save(editing)}>
            Klaar
          </button>
        </div>
      ) : (
        <div className="dashboard stagger">
          {blocks.map((b, i) => (
            <BlockView key={blockKey(b)} block={b} lists={lists} index={i} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <>
          <h2 className="section-title">Gearchiveerd</h2>
          <div className="card">
            <ul className="rows">
              {archived.map((p) => (
                <li key={p.id}>
                  <Link to={`/projecten/${p.id}`} className="row">
                    <span className="cell-main">
                      <span className="row-media">
                        <Icon name={projectIcon(p)} size={16} />
                      </span>
                      <span className="row-main">
                        <span className="row-title">{p.name}</span>
                      </span>
                    </span>
                    <Icon name="next" size={16} className="row-chevron" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {!editing && (
        <Link to="/projecten/nieuw" className="fab" aria-label="Nieuw project">
          <Icon name="plus" size={24} />
        </Link>
      )}
    </div>
  );
}
