// Back-up en terugzetten (zie shared/backup.ts en worker/routes/backup.ts), op Jouw gegevens. Enkel als je een lijst
// beheert: van die lijsten maak je een back-up. Terugzetten komt er altijd als kopie bij.

import { useState } from "react";
import { api, apiUrl } from "../api";
import { useSession } from "../session";
import { useConfirm } from "./ConfirmDialog";
import { CardHead } from "./Controls";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

export function BackupCard() {
  const { lists, reloadMe } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!lists.some((l) => l.role === "beheerder")) return null;

  async function restore(file: File) {
    setError(undefined);
    let content: unknown;
    try {
      content = JSON.parse(await file.text());
    } catch {
      setError("Dit is geen back-up van Heystack.");
      return;
    }
    const ok = await confirm({
      title: "Back-up terugzetten?",
      body: "De lijsten komen er als kopie bij. Er wordt niets overschreven.",
      confirmLabel: "Terugzetten",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await api.post<{ lists: number }>("/me/restore", content);
      reloadMe();
      toast(`Teruggezet: ${result.lists} ${result.lists === 1 ? "lijst" : "lijsten"}`);
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
          <a className="btn btn-outline" href={apiUrl("/me/backup")} download>
            <Icon name="download" size={16} /> Downloaden
          </a>
          <label className="btn btn-outline" aria-disabled={busy}>
            <Icon name="upload" size={16} /> {busy ? "Terugzetten…" : "Terugzetten"}
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
