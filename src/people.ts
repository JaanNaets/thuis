import type { Member, Taxonomy } from "../shared/types";
import { api } from "./api";
import { refreshTaxonomy } from "./taxonomy";

/** Iemand met deze naam die we al kennen (hoofdletters maken niet uit). */
export function memberByName(t: Taxonomy, name: string): Member | undefined {
  const wanted = name.trim().toLowerCase();
  return t.members.find((m) => m.name.toLowerCase() === wanted);
}

/**
 * Iemand mee laten delen die (nog) niet in de app zit. Kennen we de naam al, dan die persoon; anders een nieuwe
 * persoon zonder aanmelding (enkel projecten, woont hier niet). In een project komt die er ook als deelnemer bij.
 * Wordt die later toegevoegd met een e-mailadres, dan is het dezelfde persoon: alles wat gedeeld werd, staat er al.
 */
export async function addPerson(t: Taxonomy, projectId: string | null, name: string): Promise<Member> {
  const known = memberByName(t, name);
  const project = projectId ? t.projects.find((p) => p.id === projectId) : undefined;
  let member: Member;
  if (project) {
    if (known && project.member_ids.includes(known.id)) return known;
    member = await api.post<Member>(`/projects/${project.id}/members`, known ? { member_id: known.id } : { name: name.trim(), email: null });
  } else {
    if (known) return known;
    member = await api.post<Member>("/members", { name: name.trim(), email: null, color: null, active: false, access: "projects" });
  }
  await refreshTaxonomy();
  return member;
}
