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
    [5, "Taart appel- v zandtaartdeeg", 225, 11, 6, 28, 15, 1.5, 3, "Appeltaart"],
    [6, "Melk koffie- halfvolle", 57, 2, 1, 4, 4, 0, 3, "Koffiemelk halfvolle"],
    [7, "Koffie bereid", 1, 0, 0, 0, 0, 0, 0.1],
    [8, "Frites bereid m hard vet", 330, 17, 8, 38, 0.5, 3.5, 4, "Patat/friet bereid m hard vet"],
    [9, "Frites bereid gem", 300, 14, 3, 38, 0.5, 3.5, 4, "Patat/friet bereid gem"],
    [10, "Worst boterham-", 260, 22, 8, 3, 1, 0, 12, "Boterhamworst"],
    [11, "Yoghurt volle Activia m vruchten", 94, 3, 2, 13, 12, 0, 3.5],
    [12, "Yoghurt volle", 60, 3, 2, 4.5, 4.5, 0, 4],
    [13, "Ei kippen- gekookt gem", 140, 10, 3, 0.5, 0.5, 0, 12.5, "Kippeneieren gekookt"],
    [14, "Frites kapsalon", 216, 12, 4, 15, 2, 1.5, 12, "Friet/patat kapsalon"],
    [15, "Broodje koffie-", 349, 15, 7, 45, 15, 2, 7, "Koffiebroodje"],
    [16, "Tarwebrood bruin", 251, 3, 0.6, 43, 3, 6, 10, "Bruinbrood"],
    [17, "Tarwebrood volkoren gem", 230, 3, 0.6, 38, 2, 7, 10, "Volkorenbrood gem"],
  ],
};

test("NEVO: de beste match op naam, ongewijzigd, met de bron", () => {
  const appel = nevoMatch(data, "appel")!;
  assert.ok(["Appel m schil gem", "Appel z schil"].includes(appel.name));
  assert.equal(appel.source, "nevo");
  assert.equal(nevoMatch(data, "witte rijst")!.values.kcal, 130);
  assert.equal(nevoMatch(data, "pizza"), null, "liever niets dan iets verkeerds");
  assert.equal(nevoMatch({ version: "", foods: [] }, "appel"), null);
  // Het hoofdwoord moet kloppen: appel is geen appeltaart, koffie geen koffiemelk.
  assert.equal(nevoMatch(data, "appeltaart")!.name, "Taart appel- v zandtaartdeeg", "via het synoniem");
  assert.equal(nevoMatch(data, "koffie")!.name, "Koffie bereid");
  assert.equal(nevoMatch(data, "volle yoghurt")!.name, "Yoghurt volle", "de kortste naam");
  assert.equal(nevoMatch(data, "friet")!.name, "Frites bereid gem", "via het synoniem, gemiddeld");
  assert.equal(nevoMatch(data, "ei")!.name, "Ei kippen- gekookt gem", "ook een woord van twee letters");
  assert.equal(nevoMatch(data, "boterham"), null, "boterham is geen boterhamworst");
  assert.ok(nevoMatch(data, "brood")!.name.startsWith("Tarwebrood"), "een broodje is geen brood; tarwebrood wel");
  assert.equal(nevoMatch(data, "volkoren brood")!.name, "Tarwebrood volkoren gem", "samengesteld: volkorenbrood");
  assert.equal(nevoCredit("2025/9.0"), "NEVO-online versie 2025/9.0, RIVM, Bilthoven");
});
