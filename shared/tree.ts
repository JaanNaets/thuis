// Categorieën en plaatsen zijn bomen: "Keuken › Koelkast", "Voeding › Zuivel & eieren".

export type TreeNode = { id: string; parent_id: string | null; name: string; sort_order: number };

export type FlatNode<T> = T & { depth: number; path: string };

const collator = new Intl.Collator("nl", { sensitivity: "base", numeric: true });

function byOrder(a: TreeNode, b: TreeNode): number {
  return a.sort_order - b.sort_order || collator.compare(a.name, b.name);
}

/**
 * Zet een boom om in een lijst in leesvolgorde (ouder, dan kinderen), met diepte en volledig pad.
 * Een knoop waarvan de ouder ontbreekt, staat bovenaan. Een lus (zou niet mogen) breekt niets.
 */
export function flattenTree<T extends TreeNode>(nodes: T[], separator = " › "): FlatNode<T>[] {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string | null, T[]>();
  for (const n of nodes) {
    const parent = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), n]);
  }

  const out: FlatNode<T>[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number, prefix: string) => {
    for (const n of (children.get(parent) ?? []).sort(byOrder)) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      const path = prefix ? `${prefix}${separator}${n.name}` : n.name;
      out.push({ ...n, depth, path });
      walk(n.id, depth + 1, path);
    }
  };
  walk(null, 0, "");
  return out;
}

/** De knoop zelf en alles eronder. */
export function descendantIds(nodes: TreeNode[], id: string): Set<string> {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parent_id && result.has(n.parent_id) && !result.has(n.id)) {
        result.add(n.id);
        grew = true;
      }
    }
  }
  return result;
}

/** De bovenste voorouder (of de knoop zelf als die bovenaan staat). */
export function rootOf<T extends TreeNode>(nodes: T[], id: string): T | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let node = byId.get(id);
  const seen = new Set<string>();
  while (node?.parent_id && byId.has(node.parent_id) && !seen.has(node.id)) {
    seen.add(node.id);
    node = byId.get(node.parent_id);
  }
  return node;
}
