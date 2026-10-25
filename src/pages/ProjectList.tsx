import { templateOf } from "../../shared/fields";
import { useState } from "react";
import type { Member, ProjectListItem, Taxonomy } from "../../shared/types";
import { useApi } from "../api";
import { Avatar, Tabs } from "../components/Controls";
import { Icon } from "../components/Icon";
import { SkeletonRows, stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { formatCents, formatDate } from "../format";
import { Link } from "../router";
import { useSession } from "../session";
import { useTaxonomy } from "../taxonomy";

type Tab = "open" | "archived";

/** "12 jan – 19 jan 2027", "vanaf 3 mrt 2026", of niets. */
export function periodText(start: string | null, end: string | null): string | null {
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  if (start) return `vanaf ${formatDate(start)}`;
  if (end) return `tot ${formatDate(end)}`;
  return null;
}

/** Een rijtje avatars die over elkaar schuiven; bij veel mensen "+3". */
export function AvatarStack({ members, max = 4 }: { members: Member[]; max?: number }) {
  const shown = members.slice(0, max);
  return (
    <span className="avatar-stack" title={members.map((m) => m.name).join(", ")}>
      {shown.map((m) => (
        <Avatar key={m.id} member={m} size="sm" />
      ))}
      {members.length > max && <span className="avatar-more">+{members.length - max}</span>}
    </span>
  );
}

export function membersOf(taxonomy: Taxonomy | undefined, ids: string[]): Member[] {
  return taxonomy ? taxonomy.members.filter((m) => ids.includes(m.id)) : [];
}

/** Projecten: een verbouwing, een reis, een feest. Elk met eigen uitgaven, en wie meedoet. */
export function ProjectList() {
  const [tab, setTab] = useState<Tab>("open");
  const { data, error, loading } = useApi<ProjectListItem[]>("/projects");
  const { data: taxonomy } = useTaxonomy();
  const { full } = useSession();
  const open = data?.filter((p) => !p.archived) ?? [];
  const archived = data?.filter((p) => p.archived) ?? [];
  const shown = tab === "open" ? open : archived;

  return (
    <div className="page">
      <PageHead
        title="Projecten"
        description={full ? "Verbouwing, reis, feest: apart bijhouden, met wie meedoet" : "De projecten waarin je meedoet"}
        primary={
          full && (
            <Link to="/projecten/nieuw" className="btn btn-primary">
              <Icon name="plus" size={16} /> Nieuw project
            </Link>
          )
        }
      />

      {archived.length > 0 && (
        <Tabs
          label="Projecten"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "open", label: "Lopend", count: open.length },
            { value: "archived", label: "Gearchiveerd", count: archived.length },
          ]}
        />
      )}

      {error && <p className="error">{error}</p>}
      {!data && loading && <SkeletonRows rows={3} />}
      {data && shown.length === 0 && (
        <EmptyState
          icon="project"
          title={tab === "archived" ? "Niets gearchiveerd" : "Nog geen projecten"}
          action={
            full &&
            tab === "open" && (
              <Link to="/projecten/nieuw" className="btn btn-outline btn-sm">
                <Icon name="plus" size={16} /> Eerste project
              </Link>
            )
          }
        >
          {full
            ? "Een skireis met vrienden of de verbouwing van de badkamer: alle kosten samen, en wie wie nog moet."
            : "Iemand van het huishouden voegt je toe aan een project."}
        </EmptyState>
      )}

      {shown.length > 0 && (
        <div className="card table table-projects">
          <div className="table-head" aria-hidden="true">
            <span>Project</span>
            <span>Wie</span>
            <span>Periode</span>
            <span className="end">Uitgegeven</span>
          </div>
          <ul className="rows stagger" key={tab}>
            {shown.map((p, i) => {
              const people = membersOf(taxonomy, p.member_ids);
              const period = periodText(p.start_on, p.end_on);
              return (
                <li key={p.id} style={stagger(i)}>
                  <Link to={`/projecten/${p.id}`} className="row">
                    <span className="cell-main">
                      <span className={`row-media tone-${p.color ?? "sky"}`}>
                        <Icon name={templateOf(p.template).icon} size={16} />
                      </span>
                      <span className="row-main">
                        <span className="row-title">{p.name}</span>
                        <span className="row-meta narrow-only">
                          <span>{contentText(p)}</span>
                          {period && <span>{period}</span>}
                        </span>
                        <span className="row-meta wide-only">
                          <span>{contentText(p)}</span>
                          {p.budget_cents !== null && <span>budget {formatCents(p.budget_cents)}</span>}
                        </span>
                      </span>
                    </span>
                    <span className="col">
                      <AvatarStack members={people} />
                    </span>
                    <span className="col">{period ? <span>{period}</span> : <span className="muted">—</span>}</span>
                    <span className="row-end">{formatCents(p.total_cents)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {full && (
        <Link to="/projecten/nieuw" className="fab" aria-label="Nieuw project">
          <Icon name="plus" size={24} />
        </Link>
      )}
    </div>
  );
}

/** "3 uitgaven", "48 wijnen · 2 uitgaven": wat erin zit. */
function contentText(p: ProjectListItem): string {
  const t = templateOf(p.template);
  const parts = [];
  if (p.track_items || p.item_count) {
    parts.push(`${p.item_count} ${p.item_count === 1 ? (t.name_label === "Naam" ? "ding" : t.name_label.toLowerCase()) : t.plural_label.toLowerCase()}`);
  }
  if (p.track_expenses || p.expense_count) parts.push(p.expense_count === 1 ? "1 uitgave" : `${p.expense_count} uitgaven`);
  return parts.join(" · ");
}
