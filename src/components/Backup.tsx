// Back-up en terugzetten (zie shared/backup.ts en worker/routes/backup.ts), op Jouw gegevens. Enkel als je ergens alles
// beheert: van die projecten maak je een back-up. Terugzetten komt er altijd als kopie bij.

import { useState } from "react";
import { api, apiUrl } from "../api";
import { useNavigate } from "../router";
import { useSession } from "../session";
import { useConfirm } from "./ConfirmDialog";
import { CardHead } from "./Controls";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

export function BackupCard() {
  const { projects, reloadMe } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!projects.some((p) => p.rights.manage && p.rights.members)) return null;

  async function restore(file: File) {
    setError(undefined);
    let content: unknown;
    try {
      content = JSON.parse(await file.text());
    } catch {
      setError("Dit is geen back-up van Thuis.");
      return;
    }
    const ok = await confirm({
      title: "Back-up terugzetten?",
      body: "De projecten komen er als kopie bij. Er wordt niets overschreven.",
      confirmLabel: "Terugzetten",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await api.post<{ id: string; missing: number }>(
        "/backup",
        content,
      );
      reloadMe();
      toast(
        result.missing
          ? `Teruggezet, zonder ${result.missing} ${result.missing === 1 ? "bestand" : "bestanden"}`
          : "Teruggezet",
      );
      navigate(`/projecten/${result.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <CardHead title="Back-up" />
      <div className="card-body">
        <div className="btn-row">
          <a className="btn btn-outline" href={apiUrl("/backup")} download>
            <Icon name="download" size={16} /> Downloaden
          </a>
          <label className="btn btn-outline" aria-disabled={busy}>
            <Icon name="upload" size={16} />{" "}
            {busy ? "Terugzetten…" : "Terugzetten"}
            <input
              type="file"
              accept=".json,application/json"
              hidden
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void restore(file);
              }}
            />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}
