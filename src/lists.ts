// Je lijsten groeperen en tonen: per tag (een lijst kan bij meer tags staan), en wat zonder tag is.

import type { ListNode, Tag } from "../shared/model";
import type { Tone } from "../shared/types";
import type { IconName } from "./components/Icon";

/** Een lijst zonder eigen kleur krijgt er een, in een vaste volgorde die mooi afwisselt. */
const TONES: Tone[] = ["peach", "sky", "sage", "lilac", "butter", "rose", "mint"];

export const listTone = (l: Pick<ListNode, "color" | "id">): Tone => l.color ?? TONES[[...l.id].reduce((s, ch) => s + ch.charCodeAt(0), 0) % TONES.length];
export const listIcon = (l: Pick<ListNode, "icon" | "one">): IconName => (l.icon ?? (l.one ? "folder" : "note")) as IconName;

export type TagGroup = { tag: Tag | null; lists: ListNode[] };

/**
 * Je lijsten per tag, in de volgorde van de tags (alfabetisch), met daarna wat geen tag heeft. Gearchiveerde lijsten
 * enkel met `archived`.
 */
export function groupByTag(lists: ListNode[], tags: Tag[], archived = false): TagGroup[] {
  const live = lists.filter((l) => archived || !l.archived);
  const groups: TagGroup[] = tags.map((tag) => ({ tag, lists: live.filter((l) => l.tags.includes(tag.id)) })).filter((g) => g.lists.length);
  const loose = live.filter((l) => !l.tags.some((t) => tags.some((x) => x.id === t)));
  if (loose.length) groups.push({ tag: null, lists: loose });
  return groups;
}
