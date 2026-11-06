// Snel naar het juiste formulier van buiten de app: een eigen app met een eigen naam en bestemming (/app/:id, zie
// shared/apps.ts), een QR-sticker om af te drukken (/lijsten/:id/sticker), en een foto of tekst die je vanuit een
// andere app deelt met Thuis (/delen, Android). Zie shared/manifest.ts en STIJLBOEK.md → Snel naar een formulier.

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { destinationPath, type AppSettings } from "../../shared/apps";
import type { ListDetail } from "../../shared/model";
import { buildTargets, matchTargets, targetPath, type Targets } from "../../shared/targets";
import { useApi } from "../api";
import { Barcode } from "../components/Barcode";
import { AiMark } from "../components/Fields";
import { Icon, type IconName } from "../components/Icon";
import { EmptyState, PageHead } from "../components/Page";
import { Link, useNavigate } from "../router";
import { useSession } from "../session";
import { sharedFile } from "../shared-file";

const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** Deze pagina wijst naar een eigen manifest (en een eigen naam onder het icoon op een iPhone), zolang je er bent. */
function useOwnManifest(href: string, name: string | undefined) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const before = link?.getAttribute("href");
    link?.setAttribute("href", href);
    return () => {
      if (link && before) link.setAttribute("href", before);
    };
  }, [href]);
  useEffect(() => {
    const title = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const before = title?.content;
    if (title && name) title.content = name;
    return () => {
      if (title && before) title.content = before;
    };
  }, [name]);
}

/** In de browser: hoe je deze pagina als eigen icoon op je beginscherm zet. */
export function HomeScreenHint() {
  return (
    <section className="card home-hint">
      <ul className="rows">
        <li className="row">
          <span className="cell-main">
            <span className="row-media">
              <Icon name="share" size={16} />
            </span>
            <span className="row-main">
              <span className="row-title">iPhone: Deel → Zet op beginscherm</span>
            </span>
          </span>
        </li>
        <li className="row">
          <span className="cell-main">
            <span className="row-media">
              <Icon name="dots" size={16} />
            </span>
            <span className="row-main">
              <span className="row-title">Android: ⋮ → Toevoegen aan startscherm</span>
            </span>
          </span>
        </li>
      </ul>
    </section>
  );
}

/**
 * Een eigen app (Jouw gegevens → App): als app op je beginscherm gaat ze meteen naar haar bestemming; in de browser
 * toont ze haar naam, hoe je ze op je beginscherm zet, en Openen.
 */
export function AppPage() {
  const { appId } = useParams();
  const navigate = useNavigate();
  const { data: settings, error } = useApi<AppSettings>("/me/app");
  const app = settings?.apps.find((a) => a.id === appId);
  const [inBrowser] = useState(() => !standalone());
  useOwnManifest(`/api/me/apps/${appId}/manifest`, app?.name);
  useEffect(() => {
    if (app && !inBrowser) navigate(destinationPath(app.to), { replace: true });
  }, [app]);
  if (error) return <p className="error page">{error}</p>;
  if (!settings || (app && !inBrowser)) return null;
  if (!app)
    return (
      <div className="page">
        <EmptyState
          icon="home"
          title="Deze app bestaat niet meer"
          action={
            <Link to="/" className="btn btn-outline btn-sm">
              Naar het overzicht
            </Link>
          }
        />
      </div>
    );
  return (
    <div className="page">
      <PageHead
        title={app.name}
        back={{ to: "/ik", label: "Jouw gegevens" }}
        primary={
          <Link to={destinationPath(app.to)} className="btn btn-primary">
            Openen
          </Link>
        }
      />
      <HomeScreenHint />
    </div>
  );
}

/** Een QR-sticker voor een lijst: scannen opent het formulier (loggen, met een soort en tekst, of een ding toevoegen). */
export function StickerPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const thing = params.get("ding") === "1";
  const kind = params.get("soort");
  const text = params.get("tekst") ?? "";
  const { data: detail } = useApi<ListDetail>(`/lists/${id}`);
  const q = new URLSearchParams();
  if (kind) q.set("soort", kind);
  if (text) q.set("tekst", text);
  const url = `${window.location.origin}/lijsten/${id}/${thing ? "nieuw" : "loggen"}${q.toString() ? `?${q}` : ""}`;
  const kindName = detail?.kinds.find((k) => k.id === kind)?.name;
  const title = thing ? `${detail?.list.one ?? "Ding"} toevoegen` : kindName ? `${kindName}` : "Loggen";
  return (
    <div className="page">
      <PageHead
        title="QR-sticker"
        back={{ to: -1, label: detail?.list.name ?? "Terug" }}
        primary={
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Afdrukken
          </button>
        }
      />
      {detail && (
        <div className="sticker">
          <Barcode format="qr_code" value={url} />
          <strong>{title}</strong>
          <span>{[detail.list.name, text].filter(Boolean).join(" · ")}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Iets gedeeld vanuit een andere app (Android): een foto wordt een kasticket (✨, enkel met de AI aan, en pas na een
 * tik) of de foto van wat je logt of toevoegt; enkel tekst opent Toevoegen met die tekst.
 */
export function SharedPage() {
  const { boards } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const text = params.get("tekst") ?? "";
  const [file, setFile] = useState<File | null>();
  const { data: raw } = useApi<Targets>("/me/targets");
  const { data: settings } = useApi<AppSettings>("/me/app");
  const { ai } = useSession();
  const receipt = ai && settings?.share.kind === "receipt" ? settings.share : null;
  const preview = useMemo(() => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  const targets = useMemo(() => (raw ? buildTargets(raw) : []), [raw]);

  useEffect(() => {
    sharedFile().then(setFile);
  }, []);
  useEffect(() => {
    if (file === null) navigate(`/?toevoegen=1${text ? `&tekst=${encodeURIComponent(text)}` : ""}`, { replace: true });
    if (file && receipt) navigate(`/lijsten/${receipt.list}/loggen?kasticket=gedeeld`, { replace: true });
  }, [file, receipt]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  if (!file || !raw || !settings || receipt) return null;
  // Een kasticket: in een lijst die voorraad telt of waar je aankopen logt.
  const buyLists = ai ? raw.lists.filter((l) => l.stock || raw.used.some((u) => u.list_id === l.id && u.kind === "aankoop")) : [];
  const read = matchTargets(text, targets).slice(0, 8);
  const row = (key: string, to: string, icon: IconName, title: string, meta: string | null, aiMark = false) => (
    <li key={key}>
      <Link to={to} className="row">
        <span className="cell-main">
          <span className="row-media">
            <Icon name={icon} size={16} />
          </span>
          <span className="row-main">
            <span className="row-title">
              {title} {aiMark && <AiMark />}
            </span>
            {meta && (
              <span className="row-meta">
                <span>{meta}</span>
              </span>
            )}
          </span>
        </span>
        <Icon name="next" size={16} className="row-chevron" />
      </Link>
    </li>
  );
  return (
    <div className="page">
      <PageHead title="Gedeeld" back={{ to: "/", label: boards[0]?.name ?? "Overzicht" }} />
      {preview && <img className="shared-photo" src={preview} alt="" />}
      {buyLists.length > 0 && (
        <>
          <h2 className="section-title">Kasticket lezen</h2>
          <section className="card">
            <ul className="rows">{buyLists.map((l) => row(`r${l.id}`, `/lijsten/${l.id}/loggen?kasticket=gedeeld`, "receipt", l.name, null, true))}</ul>
          </section>
        </>
      )}
      <h2 className="section-title">Toevoegen in</h2>
      <section className="card">
        <ul className="rows">{read.map(({ target: t, rest }) => row(t.key, `${targetPath(t, rest)}${targetPath(t, rest).includes("?") ? "&" : "?"}foto=gedeeld`, (t.icon ?? "camera") as IconName, t.label, t.hint))}</ul>
      </section>
    </div>
  );
}
