// Snel naar het juiste formulier van buiten de app: een eigen icoon per lijst op je beginscherm (/snel/:id/:typeId), een
// eigen app met een eigen naam en bestemming (/app/:id, zie shared/apps.ts), een
// QR-sticker om af te drukken (/projecten/:id/sticker), en een foto of tekst die je vanuit een andere app deelt met
// Thuis (/delen, Android). Zie shared/manifest.ts en STIJLBOEK.md → Snel naar een formulier.

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { destinationPath, type AppSettings } from "../../shared/apps";
import { addPath, matchTargets, type AddTarget } from "../../shared/quickadd";
import type { ProjectDetail } from "../../shared/types";
import { useApi } from "../api";
import { Barcode } from "../components/Barcode";
import { Icon, type IconName } from "../components/Icon";
import { EmptyState, PageHead } from "../components/Page";
import { Link, useNavigate } from "../router";
import { sharedFile } from "../shared-file";
import { ItemFormFor } from "./ItemForm";

const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** Deze pagina wijst naar een eigen manifest (en een eigen naam onder het icoon op een iPhone), zolang je er bent. */
function useOwnManifest(href: string, name: string | undefined) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const title = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const before = { link: link?.getAttribute("href"), title: title?.content };
    link?.setAttribute("href", href);
    return () => {
      if (link && before.link) link.setAttribute("href", before.link);
      if (title && before.title) title.content = before.title;
    };
  }, [href]);
  useEffect(() => {
    const title = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (title && name) title.content = name;
  }, [name]);
}

/** In de browser: hoe je deze pagina als eigen icoon op je beginscherm zet (als app niet nodig). */
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
 * Een lijst als eigen icoon op je beginscherm: deze pagina wijst naar haar eigen manifest (naam en start = dit
 * formulier). In de browser staat onder de titel hoe je ze op je beginscherm zet; als app niet meer.
 */
export function QuickLinkPage() {
  const { id, typeId } = useParams();
  const { data: project } = useApi<ProjectDetail>(`/projects/${id}`);
  const type = project?.types.find((t) => t.id === typeId);
  const [inBrowser] = useState(() => !standalone());
  useOwnManifest(`/api/projects/${id}/manifest/${typeId}`, type?.name);
  return <ItemFormFor projectId={id!} typeId={typeId!} notice={inBrowser && type ? <HomeScreenHint /> : undefined} />;
}

/**
 * Een eigen app (Jouw gegevens → App): als app op je beginscherm gaat ze meteen naar haar bestemming; in de browser
 * toont ze haar naam, hoe je ze op je beginscherm zet, en Openen. Met haar eigen manifest (naam en start = deze pagina).
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

/** Een QR-sticker voor een lijst: scannen opent het formulier (met eventueel tekst, bv. "pellets"). */
export function StickerPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const typeId = params.get("lijst") ?? "";
  const text = params.get("tekst") ?? "";
  const { data: project } = useApi<ProjectDetail>(`/projects/${id}`);
  const type = project?.types.find((t) => t.id === typeId);
  const url = `${window.location.origin}${addPath({ project_id: id!, type_id: typeId }, text)}`;
  return (
    <div className="page">
      <PageHead
        title="QR-sticker"
        back={{ to: -1, label: type?.plural ?? "Terug" }}
        primary={
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Afdrukken
          </button>
        }
      />
      {type && project && (
        <div className="sticker">
          <Barcode format="qr_code" value={url} />
          <strong>{type.name} toevoegen</strong>
          <span>{[project.project.name, text].filter(Boolean).join(" · ")}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Iets gedeeld vanuit een andere app (Android): een foto wordt een kasticket bij een voorraad, of een foto die een
 * lijst leest; enkel tekst opent Toevoegen met die tekst.
 */
export function SharedPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const text = params.get("tekst") ?? "";
  const [file, setFile] = useState<File | null>();
  const { data: targets } = useApi<AddTarget[]>("/me/lists");
  const { data: settings } = useApi<AppSettings>("/me/app");
  const preview = useMemo(() => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    sharedFile().then(setFile);
  }, []);
  useEffect(() => {
    if (file === null) navigate(`/?toevoegen=1${text ? `&tekst=${encodeURIComponent(text)}` : ""}`, { replace: true });
    // Gekozen in Jouw gegevens → App: een foto gaat meteen als kasticket naar die voorraad.
    const share = settings?.share;
    if (file && share?.kind === "receipt") navigate(`/projecten/${share.project}?lijst=${share.list}&kasticket=gedeeld`, { replace: true });
  }, [file, settings]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  if (!file || !settings || settings.share.kind === "receipt") return null;
  const counters = (targets ?? []).filter((t) => t.counter);
  const read = matchTargets(text, targets ?? []).slice(0, 8);
  const row = (key: string, to: string, icon: IconName, title: string, meta: string) => (
    <li key={key}>
      <Link to={to} className="row">
        <span className="cell-main">
          <span className="row-media">
            <Icon name={icon} size={16} />
          </span>
          <span className="row-main">
            <span className="row-title">{title}</span>
            <span className="row-meta">
              <span>{meta}</span>
            </span>
          </span>
        </span>
        <Icon name="next" size={16} className="row-chevron" />
      </Link>
    </li>
  );
  return (
    <div className="page">
      <PageHead title="Gedeeld" back={{ to: "/", label: "Overzicht" }} />
      {preview && <img className="shared-photo" src={preview} alt="" />}
      {counters.length > 0 && (
        <>
          <h2 className="section-title">Kasticket bijtellen</h2>
          <section className="card">
            <ul className="rows">
              {counters.map((t) => row(`k${t.project_id}${t.type_id}`, `/projecten/${t.project_id}?lijst=${t.type_id}&kasticket=gedeeld`, "receipt", t.plural, t.project_name))}
            </ul>
          </section>
        </>
      )}
      <h2 className="section-title">Lezen in</h2>
      <section className="card">
        <ul className="rows">
          {read.map(({ target: t, rest }) =>
            row(`l${t.project_id}${t.type_id}`, `${addPath(t, rest)}&foto=gedeeld`, (t.icon ?? "camera") as IconName, t.name, t.project_name),
          )}
        </ul>
      </section>
    </div>
  );
}
