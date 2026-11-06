import { useApi } from "../api";
import { BoardView, type Overview } from "../components/Board";
import { EmptyState } from "../components/Page";
import { useSession } from "../session";

/** Het overzicht: je borden met blokken (zie components/Board.tsx en shared/board.ts). */
export function Home() {
  const board = new URLSearchParams(window.location.search).get("bord");
  const { data, error, reload } = useApi<Overview>(`/me/overview${board ? `?board=${encodeURIComponent(board)}` : ""}`);
  const { lists } = useSession();
  if (error && !data) return <p className="error page">{error}</p>;
  if (!data) return <p className="page muted">Laden…</p>;
  if (!lists.length) return <div className="page"><EmptyState icon="folder" title="Nog geen lijsten" /></div>;
  return <BoardView overview={data} onChanged={reload} />;
}
