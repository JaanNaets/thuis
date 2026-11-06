// Het overzicht: je borden (Overzicht, Keuken) met blokken die je zelf kiest (zie shared/board.ts). Elk blok haalt
// zijn inhoud op met de gewone routes, dus met jouw rechten. Zie STIJLBOEK.md → Patronen per scherm → Overzicht.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { viewName, type ActionBlock, type ViewBlock } from "../../shared/blocks";
import { BLOCK_KINDS, blockKey, segmentBlocks, type Block, type BoardInfo } from "../../shared/board";
import { formatAmount } from "../../shared/units";
import { api, useApi } from "../api";
import { Link } from "../router";
import { useSession } from "../session";
import { ActionGroup } from "./ActionBlock";
import { ActionBuilder, AddChoice, EMPTY_VIEW_BLOCK, ViewBuilder } from "./BlockBuilder";
import { usePalette } from "./CommandPalette";
import { useConfirm } from "./ConfirmDialog";
import { CardHead, Tabs } from "./Controls";
import { Icon, type IconName } from "./Icon";
import { stagger } from "./Motion";
import { EmptyState, PageHead } from "./Page";
import { Sheet } from "./Sheet";
import { useSortable } from "./Sortable";
import { useToast } from "./Toast";
import { ViewCard } from "./ViewBlock";

export type Overview = { board: string; boards: BoardInfo[]; blocks: Block[]; custom: boolean };

/** Blokken zonder gaten (metselwerk): elk blok neemt zoveel rijen van 8px als het hoog is. */
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
    // Na het tekenen aanpassen: anders meldt de browser een lus (ResizeObserver loop).
    let frame = 0;
    const sizes = new ResizeObserver((entries) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => entries.forEach((e) => fit(e.target)));
    });
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
      cancelAnimationFrame(frame);
      sizes.disconnect();
      added.disconnect();
      grid.classList.remove("masonry");
    };
  });
  return ref;
}

const BOARD_KEY = "thuis.board";
const storedBoard = () => {
  try {
    return localStorage.getItem(BOARD_KEY);
  } catch {
    return null;
  }
};
const storeBoard = (id: string) => {
  try {
    localStorage.setItem(BOARD_KEY, id);
  } catch {
    // Zonder opslag begint dit toestel bij het eerste overzicht.
  }
};

export function BoardView({ overview: first, onChanged }: { overview: Overview; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const palette = usePalette();
  const [params, setParams] = useSearchParams();
  const [boardId, setBoardId] = useState(() => params.get("bord") ?? storedBoard() ?? first.board);
  const { data: fetched, mutate } = useApi<Overview>(boardId !== first.board ? `/me/overview?board=${encodeURIComponent(boardId)}` : null);
  const overview = boardId === first.board ? first : (fetched ?? first);
  const [editing, setEditing] = useState<Block[] | null>(null);
  const [menu, setMenu] = useState<"menu" | "new" | "rename" | null>(null);
  const [boardName, setBoardName] = useState("");
  const [busy, setBusy] = useState(false);
  const masonry = useMasonry();
  const current = overview.boards.find((b) => b.id === overview.board);
  const blocks = editing ?? overview.blocks;

  // Toevoegen vanuit een snelkoppeling (?toevoegen=1, met ?tekst=).
  useEffect(() => {
    if (params.get("toevoegen") !== "1") return;
    palette("add", params.get("tekst") ?? "");
    setParams({}, { replace: true });
  }, []);

  function chooseBoard(id: string) {
    setEditing(null);
    setBoardId(id);
    storeBoard(id);
  }

  async function save(next: Block[] | null) {
    setBusy(true);
    try {
      await api.put("/me/overview", { board: overview.board, blocks: next });
      setEditing(null);
      toast("Overzicht bewaard");
      if (boardId === first.board) onChanged();
      else mutate(await api.get<Overview>(`/me/overview?board=${encodeURIComponent(boardId)}`));
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }

  async function saveBoards(next: { id?: string; name: string }[], go?: (saved: BoardInfo[]) => string) {
    setBusy(true);
    try {
      const { boards } = await api.put<{ boards: BoardInfo[] }>("/me/boards", { boards: next });
      setMenu(null);
      const to = go?.(boards);
      onChanged();
      if (to) chooseBoard(to);
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
    if (await saveBoards(overview.boards.filter((b) => b.id !== current.id), (saved) => saved[0].id)) toast(`${current.name} verwijderd`);
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
          editing ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(null)}>
              Standaard
            </button>
          ) : (
            <button type="button" className="btn btn-outline btn-icon" aria-label="Meer opties" aria-haspopup="dialog" onClick={() => setMenu("menu")}>
              <Icon name="dots" size={16} />
            </button>
          )
        }
        primary={
          !editing && (
            <button type="button" className="btn btn-primary" onClick={() => palette("add")}>
              <Icon name="plus" size={16} /> Toevoegen
            </button>
          )
        }
      />
      {overview.boards.length > 1 && !editing && (
        <Tabs label="Overzicht" value={overview.board} tabs={overview.boards.map((b) => ({ value: b.id, label: b.name }))} onChange={chooseBoard} />
      )}

      {editing ? (
        <div className="form">
          <BlocksEditor blocks={editing} onChange={setEditing} />
          <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => save(editing)}>
            Klaar
          </button>
        </div>
      ) : blocks.length === 0 ? (
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
          {segmentBlocks(blocks).map((b, i) =>
            Array.isArray(b) ? <ActionGroup key={`acties:${blockKey(b[0])}`} blocks={b} index={i} /> : <BlockView key={blockKey(b)} block={b} index={i} />,
          )}
        </div>
      )}

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
            {overview.boards.length > 1 && menuRow("trash", "Verwijderen", removeBoard)}
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
                  const before = new Set(overview.boards.map((b) => b.id));
                  if (await saveBoards([...overview.boards, { name }], (saved) => saved.find((b) => !before.has(b.id))?.id ?? saved[0].id)) toast(`${name} gemaakt`);
                } else if (current && (await saveBoards(overview.boards.map((b) => (b.id === current.id ? { ...b, name } : b))))) toast("Hernoemd");
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

// ---------- blokken ----------

function BlockView({ block, index }: { block: Block; index: number }) {
  if (block.kind === "action") return <ActionGroup blocks={[block]} index={index} />;
  return (
    <div className={`dash-block${block.wide ? " is-wide" : ""}`} style={stagger(index)}>
      {block.kind === "view" ? <ViewCard block={block} /> : <ThingBlock id={block.thing} />}
    </div>
  );
}

/** Eén ding: zijn naam en voorraad (de pellets op zolder). */
function ThingBlock({ id }: { id: string }) {
  const { data } = useApi<{ thing: { id: string; name: string }; stock: { amount: number; unit: string | null; low: boolean } | null; list: { name: string } }>(`/things/${id}`);
  if (!data) return null;
  return (
    <Link to={`/dingen/${id}`} className="card dash-card dash-link">
      <CardHead title={data.thing.name} description={data.list.name} />
      {data.stock && (
        <div className="card-body">
          <span className={`total-value${data.stock.low ? " is-low" : ""}`}>{formatAmount(data.stock.amount, data.stock.unit)}</span>
        </div>
      )}
    </Link>
  );
}

// ---------- aanpassen ----------

function blockLabel(b: Block, lists: { id: string; name: string }[]): string {
  const listName = (id: string) => lists.find((l) => l.id === id)?.name;
  if (b.kind === "view") return viewName(b, listName);
  if (b.kind === "action") return b.name || `${BLOCK_KINDS.action} · ${listName(b.list) ?? "lijst"}`;
  return BLOCK_KINDS.thing;
}

/** Wat de bouwer toont: kiezen tussen weergave en actie, of een weergave of actie samenstellen (`index` null: nieuw). */
type Building = { step: "choose" } | { step: "view"; index: number | null; block: ViewBlock } | { step: "action"; index: number | null; block: ActionBlock };

function BlocksEditor({ blocks, onChange }: { blocks: Block[]; onChange: (b: Block[]) => void }) {
  const { lists } = useSession();
  const [building, setBuilding] = useState<Building | null>(null);
  const keys = blocks.map((b, i) => `${i}:${blockKey(b)}`);
  const sortable = useSortable(
    keys,
    (next) => onChange(next.map((k) => blocks[keys.indexOf(k)])),
    (k) => blockLabel(blocks[keys.indexOf(k)], lists),
  );
  function put(index: number | null, b: Block) {
    onChange(index === null ? [...blocks, b] : blocks.map((x, k) => (k === index ? { ...b, ...(x.wide ? { wide: true } : {}) } : x)));
    setBuilding(null);
  }
  const close = () => setBuilding(null);
  return (
    <>
      <ul className="rows sort-list">
        {blocks.map((b, i) => (
          <li key={keys[i]} {...sortable.itemProps(keys[i])}>
            <div className="row">
              <button {...sortable.handleProps(keys[i])}>
                <Icon name="grip" size={16} />
              </button>
              <span className="cell-main">
                <span className={`row-media${b.kind === "action" ? " is-brand" : ""}`}>
                  <Icon name={b.kind === "view" ? "table" : b.kind === "action" ? "plus" : "package"} size={15} />
                </span>
                <span className="row-title">{blockLabel(b, lists)}</span>
              </span>
              {b.kind !== "thing" && (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label={`${blockLabel(b, lists)} aanpassen`}
                  onClick={() => setBuilding(b.kind === "view" ? { step: "view", index: i, block: b } : { step: "action", index: i, block: b })}
                >
                  <Icon name="edit" size={15} />
                </button>
              )}
              <button type="button" className="filter wide-only" aria-pressed={Boolean(b.wide)} onClick={() => onChange(blocks.map((x, k) => (k === i ? { ...x, wide: !x.wide || undefined } : x)))}>
                Breed
              </button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${blockLabel(b, lists)} weghalen`} onClick={() => onChange(blocks.filter((_, k) => k !== i))}>
                <Icon name="close" size={15} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {sortable.status}
      <button type="button" className="btn btn-outline btn-sm" style={{ justifySelf: "start" }} onClick={() => setBuilding({ step: "choose" })}>
        <Icon name="plus" size={15} /> Toevoegen
      </button>
      <Sheet
        open={building !== null}
        title={building?.step === "view" ? "Weergave" : building?.step === "action" ? "Actie" : "Blok toevoegen"}
        onClose={close}
        className={building && building.step !== "choose" ? "builder-sheet" : undefined}
      >
        {building?.step === "choose" && (
          <AddChoice
            onPick={(kind) =>
              setBuilding(
                kind === "view"
                  ? { step: "view", index: null, block: EMPTY_VIEW_BLOCK }
                  : { step: "action", index: null, block: { kind: "action", name: "", list: lists[0]?.id ?? "", type: "", does: "form", values: {} } },
              )
            }
          />
        )}
        {building?.step === "view" && (
          <ViewBuilder key={building.index ?? "nieuw"} initial={building.block} saveLabel={building.index === null ? "Op het bord zetten" : "Bewaren"} onSave={(b) => put(building.index, b)} onCancel={close} />
        )}
        {building?.step === "action" && (
          <ActionBuilder key={building.index ?? "nieuw"} initial={building.block} saveLabel={building.index === null ? "Op het bord zetten" : "Bewaren"} onSave={(b) => put(building.index, b)} onCancel={close} />
        )}
      </Sheet>
    </>
  );
}
