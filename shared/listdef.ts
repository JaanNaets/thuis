// Wat er van buiten komt voor een lijst of een soort nakijken: velden, voorraad, melding.
//
// De velden gaan door `cleanFields` (shared/fields.ts). Wat in het nieuwe model niet meer bestaat, valt weg: tellen
// via een verwijzing (`adjust`, dat doen lijnen nu), Meteen ook (`spawn`), een teller op een getal (`counter`, dat is
// `stock` op de lijst), het geheugen per veld en de timer (een activiteit met een begin en een einde). Berekeningen
// rekenen enkel met de velden van het ding zelf (geen lookup of rollup: wat lijsten verbindt, zijn lijnen).

import { isLinkCalc } from "./calc.ts";
import { cleanFields, type FieldDef } from "./fields.ts";

const DROP = ["adjust", "spawn", "counter", "measure", "remember", "remember_by", "remember_fixed", "timer_goal", "timer_into"] as const;

function strip(f: FieldDef): FieldDef {
  const out = { ...f } as Record<string, unknown>;
  for (const k of DROP) delete out[k];
  return out as FieldDef;
}

/** De velden van de dingen van een lijst. Gooit een fout met uitleg als iets niet klopt. */
export function cleanListFields(raw: unknown): FieldDef[] {
  const fields = cleanFields(raw).map(strip);
  for (const f of fields) {
    if (f.type === "timer") throw new Error(`"${f.label}": een timer is nu een activiteit in het logboek`);
    if (isLinkCalc(f)) throw new Error(`"${f.label}": een berekening rekent enkel met de velden van het ding zelf`);
  }
  return fields;
}

/** De velden van een eigen soort (Gegeten met kcal, Carwash met een programma). */
export function cleanKindFields(raw: unknown): FieldDef[] {
  return cleanListFields(raw);
}
