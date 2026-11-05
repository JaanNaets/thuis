// Snel naar het juiste formulier van buiten de app: een eigen icoon per lijst op je beginscherm (/snel/:id/:typeId), een
// QR-sticker om af te drukken (/projecten/:id/sticker), en een foto of tekst die je vanuit een andere app deelt met
// Thuis (/delen, Android). Zie shared/manifest.ts en STIJLBOEK.md → Snel naar een formulier.

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { addPath, matchTargets, type AddTarget } from "../../shared/quickadd";
import type { ProjectDetail } from "../../shared/types";
import { useApi } from "../api";
import { Barcode } from "../components/Barcode";
import { Icon, type IconName } from "../components/Icon";
import { PageHead } from "../components/Page";
import { Link, useNavigate } from "../router";
import { sharedFile } from "../shared-file";
import { ItemFormFor } from "./ItemForm";

const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/**
 * Een lijst als eigen icoon op je beginscherm: deze pagina wijst naar haar eigen manifest (naam en start = dit
 * formulier). In de browser staat bovenaan hoe je ze op je beginscherm zet; als app niet meer.
 */
export function QuickLinkPage() {
  const { id, typeId } = useParams();
  const { data: project } = useApi<ProjectDetail>(`/projects/${id}`);
  const type = project?.types.find((t) => t.id === typeId);
  const [inBrowser] = useState(() => !standalone());

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const title = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const before = { link: link?.getAttribute("href"), title: title?.content };
    link?.setAttribute("href", `/api/projects/${id}/manifest/${typeId}`);
    return () => {
      if (link && before.link) link.setAttribute("href", before.link);
      if (title && before.title) title.content = before.title;
    };
  }, [id, typeId]);

  // De naam onder het icoon op een iPhone.
  useEffect(() => {
    const title = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (title && type) title.content = type.name;
  }, [type]);

  const hint = inBrowser && type && (
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
  return <ItemFormFor projectId={id!} typeId={typeId!} notice={hint || undefined} />;
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
  const preview = useMemo(() => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    sharedFile().then(setFile);
  }, []);
  useEffect(() => {
    if (file === null) navigate(`/?toevoegen=1${text ? `&tekst=${encodeURIComponent(text)}` : ""}`, { replace: true });
  }, [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  if (!file) return null;
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
