import assert from "node:assert/strict";
import { test } from "node:test";
import { canCreate, canDelete, cleanRights, DEFAULT_ROLES, fieldAccess, mergeEditable, typeAccess, visibleData, type Rights } from "../shared/access.ts";
import type { FieldDef } from "../shared/fields.ts";

const fields: FieldDef[] = [
  { key: "prijs", label: "Prijs", type: "money" },
  { key: "score", label: "Score", type: "score" },
  { key: "notitie", label: "Notitie", type: "longtext" },
];

test("standaardrollen", () => {
  const [admin, member, viewer] = DEFAULT_ROLES.map((r) => r.rights);
  assert.equal(canCreate(admin, "t") && canDelete(admin, "t") && admin.manage && admin.members, true);
  assert.equal(canCreate(member, "t") && !member.manage && !member.members, true);
  assert.equal(canCreate(viewer, "t") || fieldAccess(viewer, "t", "prijs") !== "view", false);
});

test("per lijst en per veld: niet zien, zien of wijzigen", () => {
  const rights: Rights = {
    manage: false,
    members: false,
    create: true,
    delete: false,
    items: "view",
    types: { wijn: { access: "view", fields: { score: "edit", prijs: "none" } }, geheim: { access: "none", fields: { score: "edit" } } },
  };
  assert.equal(typeAccess(rights, "wijn"), "view");
  assert.equal(fieldAccess(rights, "wijn", "score"), "edit");
  assert.equal(fieldAccess(rights, "wijn", "prijs"), "none");
  assert.equal(fieldAccess(rights, "wijn", "notitie"), "view");
  // Wie de lijst niet ziet, ziet ook geen veld, zelfs met een uitzondering.
  assert.equal(fieldAccess(rights, "geheim", "score"), "none");
  // Toevoegen mag enkel als je de lijst mag wijzigen.
  assert.equal(canCreate(rights, "wijn"), false);
  assert.deepEqual(visibleData(rights, "wijn", fields, { prijs: 2000, score: 4, notitie: "lekker" }), { score: 4, notitie: "lekker" });
});

test("bewaren: enkel wat je mag wijzigen verandert, ook niet door weglaten", () => {
  const rights: Rights = { manage: false, members: false, create: false, delete: false, items: "view", types: { wijn: { fields: { score: "edit" } } } };
  const existing = { prijs: 2000, score: 3, notitie: "oud" };
  assert.deepEqual(mergeEditable(rights, "wijn", fields, existing, { prijs: 1, score: 4.5 }), { prijs: 2000, score: 4.5, notitie: "oud" });
  assert.deepEqual(mergeEditable(rights, "wijn", fields, existing, {}), { prijs: 2000, notitie: "oud" });
});

test("rechten nakijken", () => {
  assert.deepEqual(
    cleanRights({
      manage: true,
      items: "edit",
      types: { "t-1": { access: "nope", fields: { score: "edit", "Bad Key": "edit" } }, "x y": { access: "none" } },
      hack: 1,
    }),
    { manage: true, members: false, create: false, delete: false, items: "edit", types: { "t-1": { fields: { score: "edit" } } } },
  );
  assert.equal(cleanRights(null).items, "view");
});
