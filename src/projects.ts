import { flattenTree, type FlatNode } from "../shared/tree";
import type { ProjectNode } from "../shared/types";

/** De boom van je projecten in leesvolgorde: elk project met zijn diepte (een project waarvan je de ouder niet ziet, staat bovenaan). */
export function projectTree(projects: ProjectNode[], withArchived = false): FlatNode<ProjectNode>[] {
  return flattenTree(projects.filter((p) => withArchived || !p.archived));
}

/** De directe kinderen van een project (of de bovenste projecten). */
export function childrenOf(projects: ProjectNode[], parentId: string | null): ProjectNode[] {
  const ids = new Set(projects.map((p) => p.id));
  return projects.filter((p) => (parentId ? p.parent_id === parentId : !p.parent_id || !ids.has(p.parent_id)));
}
