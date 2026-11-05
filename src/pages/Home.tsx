import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { blockKey, blockProjects, defaultBlocks, type Block, type BoardInfo } from "../../shared/overview";
import type { Overview } from "../../shared/types";
import { api, useApi } from "../api";
import { AddPalette } from "../components/AddPalette";
import { useConfirm } from "../components/ConfirmDialog";
import { Tabs } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { BlocksEditor, BlockView } from "../components/OverviewBlocks";
import { EmptyState, PageHead } from "../components/Page";
import { projectIcon } from "../components/Sidebar";
import { useToast } from "../components/Toast";
import { projectTree } from "../projects";
import { Link } from "../router";
import { useSession } from "../session";

/**
 * Blokken zonder gaten (metselwerk): elk blok neemt zoveel rijen van 8px als het hoog is, zodat een kort blok niet een
 * hele rij naast een hoog blok leeg laat. De volgorde blijft die van je overzicht, behalve dat een kort blok een gat
 * erboven opvult (`dense`).
 */
function useMasonry() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const ROW = 8;
    const GAP = 16;
    const fit = (el: Element) => {
      (el as HTMLElement).style.gridRowEnd = `span ${Math.ceil((el.getBoundingClientRect().height + GAP) / ROW)}`;
    };
    const sizes = new ResizeObserver((entries) => entries.forEach((e) => fit(e.target)));
    const watch = () => {
      for (const el of grid.children) {
        fit(el);
        sizes.observe(el);
      }
    };
    watch();
    grid.classList.add("masonry");
    const added = new MutationObserver(watch);
    added.observe(grid, { childList: true });
    return () => {
      sizes.disconnect();
      added.disconnect();
      grid.classList.remove("masonry");
    };
  });
  return ref;
}

/** Welk overzicht dit toestel toont (de keukentablet "Keuken", je gsm "Thuis"); ?bord= kiest er een. */
const BOARD_KEY = "thuis.board";
function storedBoard(): string | null {
  try {
    return localStorage.getItem(BOARD_KEY);
  } catch {
    return null;
  }
}
function storeBoard(id: string) {
  try {
    localStorage.setItem(BOARD_KEY, id);
  } catch {
    // Zonder opslag begint dit toestel gewoon bij het eerste overzicht.
  }
}

/**
 * Je overzichten (zie shared/overview.ts): elk met de blokken die je koos, of vanzelf elk project met zijn lijsten.
 * Bovenaan wissel je tussen je overzichten (dit toestel onthoudt welk). Toevoegen (+) opent het palet om in een lijst
 * iets toe te voegen of een nieuw project te maken; onder ⋯ pas je een overzicht aan, maak je er een nieuw, of
 * hernoem en verwijder je het. De volgorde van je projecten in de boom zet je bij Jouw gegevens.
 */
export function Home() {
  const { projects } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [boardId, setBoardId] = useState(() => params.get("bord") ?? storedBoard());
  const { data: base, mutate, error } = useApi<Overview>(`/me/overview${boardId ? `?board=${encodeURIComponent(boardId)}` : ""}`);
  const tree = projectTree(projects, true);
  const active = tree.filter((p) => !p.archived);
  const archived = tree.filter((p) => p.archived);
  const [editing, setEditing] = useState<Block[] | null>(null);
  const masonry = useMasonry();
  const [busy, setBusy] = useState(false);
  // Toevoegen: ook vanuit een snelkoppeling (?toevoegen=1) of met gedeelde tekst (?tekst=).
  const [adding, setAdding] = useState(params.get("toevoegen") === "1");
  const [menu, setMenu] = useState<"menu" | "new" | "rename" | null>(null);
  const [boardName, setBoardName] = useState("");
  const boards = base?.boards ?? [];
  const current = boards.find((b) => b.id === base?.board);
  const blocks = editing ?? base?.blocks ?? defaultBlocks(active);
  // De server stuurt enkel de lijsten van de projecten in je blokken; een project dat je net toevoegde, komt apart.
  const missing = base ? blockProjects(blocks).filter((id) => !base.projects.some((p) => p.id === id)) : [];
  const { data: extra } = useApi<Overview>(missing.length ? `/me/overview?projects=${missing.join(",")}` : null);
  const overview = base && { ...base, projects: [...base.projects, ...(extra?.projects ?? [])] };
  const lists = new Map(overview?.projects.map((p) => [p.id, p.types]));

  // ?bord= (een app, Openen op of een snelkoppeling): dat overzicht tonen, ook als het overzicht al open stond.
  const linked = params.get("bord");
  useEffect(() => {
    if (linked) setBoardId(linked);
  }, [linked]);

  // Een overzicht kiezen: dit toestel onthoudt het (een app of Openen op die er een kiest via ?bord=, niet).
  function chooseBoard(id: string) {
    setEditing(null);
    setBoardId(id);
    storeBoard(id);
    if (params.has("bord")) setParams({}, { replace: true });
  }

  async function save(next: Block[] | null) {
    setBusy(true);
    try {
      const { blocks: saved } = await api.put<{ blocks: Block[] | null }>("/me/overview", { board: base?.board, blocks: next });
      if (overview) mutate({ ...overview, blocks: saved });
      setEditing(null);
      toast("Overzicht bewaard");
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }

  /** Je overzichten met nieuwe namen of volgorde (een nieuw zonder id); daarna naar `go` (of blijven). */
  async function saveBoards(next: { id?: string; name: string }[], go?: (saved: BoardInfo[]) => string) {
    setBusy(true);
    try {
      const { boards: saved } = await api.put<{ boards: BoardInfo[] }>("/me/boards", { boards: next });
      setMenu(null);
      const to = go?.(saved);
      if (to && to !== base?.board) chooseBoard(to);
      else if (overview) mutate({ ...overview, boards: saved });
      return true;
    } catch (err) {
      toast((err as Error).message, "alert");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeBoard() {
    if (!current || !(await confirm({ title: `${current.name} verwijderen?`, confirmLabel: "Verwijderen", danger: true }))) return;
    if (await saveBoards(boards.filter((b) => b.id !== current.id), (saved) => saved[0].id)) toast(`${current.name} verwijderd`);
  }

  const menuRow = (icon: IconName, label: string, run: () => void) => (
    <li key={label}>
      <button type="button" className="row" onClick={run}>
        <span className="cell-main">
          <span className="row-media">
            <Icon name={icon} size={16} />
          </span>
          <span className="row-title">{label}</span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="page">
      <PageHead
        title={current?.name ?? "Overzicht"}
        actions={
          active.length > 0 &&
          overview &&
          (editing ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(null)}>
              Standaard
            </button>
          ) : (
            <button type="button" className="btn btn-outline btn-icon" aria-label="Meer opties" aria-haspopup="dialog" onClick={() => setMenu("menu")}>
              <Icon name="dots" size={16} />
            </button>
          ))
        }
        primary={
          !editing && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} /> Toevoegen
            </button>
          )
        }
      />

      {boards.length > 1 && !editing && (
        <Tabs label="Overzicht" value={base?.board ?? boards[0].id} tabs={boards.map((b) => ({ value: b.id, label: b.name }))} onChange={chooseBoard} />
      )}

      {error && <p className="error">{error}</p>}
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
      ) : base && blocks.length === 0 ? (
        <EmptyState
          icon="sliders"
          title="Leeg overzicht"
          action={
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing([])}>
              <Icon name="sliders" size={15} /> Aanpassen
            </button>
          }
        />
      ) : (
        <div className="dashboard stagger" ref={masonry}>
          {blocks.map((b, i) => (
            <BlockView key={blockKey(b)} block={b} lists={lists} index={i} />
          ))}
        </div>
      )}

      {archived.length > 0 && !editing && (
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
        <button type="button" className="fab" aria-label="Toevoegen" onClick={() => setAdding(true)}>
          <Icon name="plus" size={24} />
        </button>
      )}

      <AddPalette
        open={adding}
        text={params.get("tekst") ?? ""}
        onClose={() => {
          setAdding(false);
          if (params.has("toevoegen") || params.has("tekst")) setParams({}, { replace: true });
        }}
      />

      <Sheet open={menu !== null} title={menu === "new" ? "Nieuw overzicht" : (current?.name ?? "Overzicht")} onClose={() => setMenu(null)}>
        {menu === "menu" ? (
          <ul className="rows sheet-menu">
            {menuRow("sliders", "Aanpassen", () => {
              setMenu(null);
              setEditing(blocks);
            })}
            {menuRow("plus", "Nieuw overzicht", () => {
              setBoardName("");
              setMenu("new");
            })}
            {menuRow("edit", "Hernoemen", () => {
              setBoardName(current?.name ?? "");
              setMenu("rename");
            })}
            {boards.length > 1 && menuRow("trash", "Verwijderen", removeBoard)}
          </ul>
        ) : (
          menu && (
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = boardName.trim();
                if (!name) return;
                if (menu === "new") {
                  const before = new Set(boards.map((b) => b.id));
                  if (await saveBoards([...boards, { name }], (saved) => saved.find((b) => !before.has(b.id))?.id ?? saved[0].id)) toast(`${name} gemaakt`);
                } else if (current) {
                  if (await saveBoards(boards.map((b) => (b.id === current.id ? { ...b, name } : b)))) toast("Hernoemd");
                }
              }}
            >
              <label className="field">
                <span className="label">Naam</span>
                <input autoFocus required maxLength={30} value={boardName} placeholder="bv. Keuken" onChange={(e) => setBoardName(e.target.value)} />
              </label>
              <button type="submit" className="btn btn-primary" disabled={busy || !boardName.trim()}>
                {menu === "new" ? "Maken" : "Bewaren"}
              </button>
            </form>
          )
        )}
      </Sheet>
    </div>
  );
}
