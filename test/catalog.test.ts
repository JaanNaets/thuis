import assert from "node:assert/strict";
import { test } from "node:test";
import { TEMPLATES } from "../shared/catalog.ts";
import { hasKcal } from "../shared/food.ts";
import { cleanKindFields, cleanListFields } from "../shared/listdef.ts";
import { BASES } from "../shared/model.ts";

test("de sjablonen: een lege lijst, Uitgaven en Dieet, en ze kloppen", () => {
  assert.deepEqual(
    TEMPLATES.map((t) => t.label ?? t.name),
    ["Lege lijst", "Uitgaven", "Dieet"],
  );
  for (const t of TEMPLATES) {
    assert.deepEqual(cleanListFields(t.fields), t.fields, `${t.name}: de velden blijven zoals ze zijn`);
    for (const k of t.kinds ?? []) {
      assert.ok(Object.hasOwn(BASES, k.base));
      assert.deepEqual(cleanKindFields(k.fields ?? []), k.fields ?? [], `${t.name} → ${k.name}`);
    }
  }
  const uitgaven = TEMPLATES.find((t) => t.key === "uitgaven")!;
  assert.equal(uitgaven.kinds?.[0].base, "aankoop", "een uitgave is een aankoop (gelijk verdeeld, Wie moet wie)");
  assert.deepEqual(uitgaven.notify, { to: "people" });
  const dieet = TEMPLATES.find((t) => t.key === "dieet")!;
  const gegeten = dieet.kinds?.find((k) => k.base === "gebruik");
  assert.ok(gegeten && hasKcal(gegeten.fields ?? []), "Gegeten telt als eten (Eten vandaag)");
});
