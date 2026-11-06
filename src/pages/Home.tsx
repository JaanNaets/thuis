import { useParams } from "react-router";
import { useApi } from "../api";
import { BoardView, type Overview } from "../components/Board";
import { EmptyState } from "../components/Page";
import { useSession } from "../session";

/** Een bord met zijn blokken (zie components/Board.tsx en shared/board.ts): / is het eerste, /bord/:id een ander. */
export function Home() {
  const { boardId: board } = useParams();
  const { data, error, reload } = useApi<Overview>(`/me/overview${board ? `?board=${encodeURIComponent(board)}` : ""}`);
  const { lists } = useSession();
  if (error && !data) return <p className="error page">{error}</p>;
  if (!data) return <p className="page muted">Laden…</p>;
  if (!lists.length) return <div className="page"><EmptyState icon="folder" title="Nog geen lijsten" /></div>;
  return <BoardView key={data.board} overview={data} onChanged={reload} />;
}
