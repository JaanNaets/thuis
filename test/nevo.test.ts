import assert from "node:assert/strict";
import { test } from "node:test";
import { nevoCredit, nevoMatch, type NevoData } from "../shared/nevo.ts";

const data: NevoData = {
  version: "2025/9.0",
  foods: [
    [1, "Appel m schil gem", 54, 0.1, 0, 12, 10, 2, 0.3],
    [2, "Appel z schil", 50, 0.1, 0, 11.5, 10, 1.6, 0.3],
    [3, "Appelmoes", 75, 0, 0, 18, 15, 1.2, 0.2],
    [4, "Rijst witte gekookt", 130, 0.3, 0.1, 28, 0, 0.4, 2.7],
  ],
};

test("NEVO: de beste match op naam, ongewijzigd, met de bron", () => {
  const appel = nevoMatch(data, "appel")!;
  assert.ok(["Appel m schil gem", "Appel z schil"].includes(appel.name));
  assert.equal(appel.source, "nevo");
  assert.equal(nevoMatch(data, "witte rijst")!.values.kcal, 130);
  assert.equal(nevoMatch(data, "pizza"), null, "liever niets dan iets verkeerds");
  assert.equal(nevoMatch({ version: "", foods: [] }, "appel"), null);
  assert.equal(nevoCredit("2025/9.0"), "NEVO-online versie 2025/9.0, RIVM, Bilthoven");
});
