import assert from "node:assert/strict";
import { test } from "node:test";
import { addPath, matchTargets, rankTargets, type AddTarget } from "../shared/quickadd.ts";

const t = (type_id: string, name: string, plural: string, project_name: string, used = 0, last: string | null = null): AddTarget => ({
  project_id: `p-${project_name}`,
  project_name,
  type_id,
  name,
  plural,
  icon: null,
  used,
  last,
  counter: false,
  receipt: false,
  stocks: [],
});
const lists = [
  t("b", "Bijvulling", "Bijvullen", "Pelletkachel", 12, "2026-11-04"),
  t("u", "Uitgave", "Uitgaven", "Slachterijstraat 1", 30, "2026-11-05"),
  t("o", "Onderhoud", "Onderhoud", "Pelletkachel"),
  t("w", "Wijn", "Wijnen", "Wijnkelder", 2),
  t("r", "Rode wijn", "Rode wijnen", "Wijnkelder"),
];
const names = (r: { target: AddTarget; rest: string }[]) => r.map((x) => `${x.target.name}|${x.rest}`);

test("toevoegen: de meestgebruikte lijsten eerst", () => {
  assert.deepEqual(rankTargets(lists).map((x) => x.type_id), ["u", "b", "w", "o", "r"]);
  assert.deepEqual(names(matchTargets("", lists)).slice(0, 2), ["Uitgave|", "Bijvulling|"]);
});

test("toevoegen: de lijst uit de eerste woorden, de rest gaat mee naar het formulier", () => {
  assert.deepEqual(names(matchTargets("bijv", lists)), ["Bijvulling|"]);
  assert.deepEqual(names(matchTargets("bijvullen 3 zakken pellets", lists)), ["Bijvulling|3 zakken pellets"]);
  assert.deepEqual(names(matchTargets("uitgave pellets 40 euro", lists)), ["Uitgave|pellets 40 euro"]);
  // Twee woorden: Rode wijn; één woord "wijn" past ook bij Rode wijn (een woord in de naam).
  assert.deepEqual(names(matchTargets("rode wijn bordeaux", lists)), ["Rode wijn|bordeaux"]);
  assert.deepEqual(names(matchTargets("wijn", lists)), ["Wijn|", "Rode wijn|"]);
  // Een project, eventueel met een lijst erin.
  assert.deepEqual(names(matchTargets("pelletkachel", lists)), ["Bijvulling|", "Onderhoud|"]);
  assert.deepEqual(names(matchTargets("pelletkachel onderh filter", lists)), ["Onderhoud|filter"]);
  // Niets herkend: alle lijsten, met de hele tekst (en niet "sterk": dan komt zoeken eerst).
  assert.equal(matchTargets("3 zakken pellets", lists)[0].rest, "3 zakken pellets");
  assert.equal(matchTargets("3 zakken pellets", lists).length, 5);
  assert.equal(matchTargets("3 zakken pellets", lists)[0].strong, false);
  assert.equal(matchTargets("bijv 3", lists)[0].strong, true);
  assert.equal(matchTargets("pelletkachel", lists)[0].strong, true);
});

test("toevoegen: het pad naar het formulier", () => {
  assert.equal(addPath(lists[0]), "/projecten/p-Pelletkachel/nieuw?lijst=b");
  assert.equal(addPath(lists[0], " 3 zakken "), "/projecten/p-Pelletkachel/nieuw?lijst=b&tekst=3%20zakken");
});
