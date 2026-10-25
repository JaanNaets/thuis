import { useRef, useState, type ReactNode } from "react";
import { parseTemplateFile, templateSummary, type TemplateFile } from "../../shared/template-file";
import { api } from "../api";
import { isKiosk } from "../device";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

/** "Wijnkelder" → "wijnkelder.thuis.json". */
function fileName(name: string) {
  const slug = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "sjabloon"}.thuis.json`;
}

const toFile = (template: TemplateFile) => new File([JSON.stringify(template, null, 2)], fileName(template.project.name), { type: "application/json" });

/** Kan dit toestel een bestand delen (mail, berichten, AirDrop)? Meestal enkel op een gsm of tablet. */
const canShareFiles = () => {
  try {
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [new File(["{}"], "x.json", { type: "application/json" })] });
  } catch {
    return false;
  }
};

/**
 * Een sjabloon bewaren als bestand, of meteen delen. `path`: waar de API het sjabloon maakt (een project of één
 * lijst). Op een kiosk niet (daar deel je niets).
 */
export function ShareTemplate({ path }: { path: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (isKiosk) return null;

  async function run(share: boolean) {
    setBusy(true);
    try {
      const file = toFile(await api.get<TemplateFile>(path));
      if (share) {
        try {
          await navigator.share({ files: [file], title: file.name });
        } catch (err) {
          if ((err as Error).name !== "AbortError") throw err;
        }
        return;
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast("Sjabloon bewaard");
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="btn-row">
      <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(false)}>
        <Icon name="download" size={16} /> Als bestand bewaren
      </button>
      {canShareFiles() && (
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(true)}>
          <Icon name="share" size={16} /> Delen…
        </button>
      )}
    </div>
  );
}

/** Een sjabloon inlezen uit een bestand (nagekeken; de API kijkt het nog eens na). */
export async function readTemplateFile(file: File): Promise<TemplateFile> {
  if (file.size > 400_000) throw new Error("Dit bestand is te groot voor een sjabloon.");
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error("Dit is geen sjabloon van Thuis.");
  }
  return parseTemplateFile(raw);
}

/**
 * Een knop die een sjabloonbestand laat kiezen en inleest. `children`: de tekst op de knop. Een fout (geen sjabloon,
 * te nieuw) komt eronder.
 */
export function TemplateFilePicker({
  onRead,
  children,
  className = "btn btn-outline",
}: {
  onRead: (t: TemplateFile) => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.click()}>
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            setError(undefined);
            onRead(await readTemplateFile(file));
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
      {error && <p className="error small">{error}</p>}
    </>
  );
}

/** Wat in een sjabloon zit, in één regel: "Wijnen, Verkopers · 1 subproject". */
export function templateText(t: TemplateFile): string {
  const { lists, projects } = templateSummary(t);
  const parts = [lists.length ? lists.join(", ") : "Nog geen lijsten"];
  if (projects) parts.push(projects === 1 ? "1 subproject" : `${projects} subprojecten`);
  return parts.join(" · ");
}
