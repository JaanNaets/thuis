// Waar een lijst voor jou staat (zie STIJLBOEK.md → Je lijsten): in het menu en bij de + (Toevoegen). Een hulplijst
// zoals Winkels verberg je; zoeken, Verbanden en de keuzelijsten tonen ze altijd. Per persoon: Jana kiest zelf.

import { useEffect, useState } from "react";
import { LIST_PLACES, shownIn, type Hidden, type ListPlace } from "../../shared/apps";
import { api } from "../api";
import { useSession } from "../session";
import { Switch } from "./Controls";
import { useToast } from "./Toast";

/** Je verborgen lijsten, meteen aangepast (en bewaard met PUT /me/hidden). */
export function useListPlaces() {
  const { hidden, reloadMe } = useSession();
  const toast = useToast();
  const [local, setLocal] = useState<Hidden>(hidden);
  useEffect(() => setLocal(hidden), [hidden]);
  async function set(list: string, place: ListPlace, shown: boolean) {
    const before = local;
    setLocal((h) => ({ ...h, [place]: shown ? h[place].filter((x) => x !== list) : [...h[place].filter((x) => x !== list), list] }));
    try {
      await api.put("/me/hidden", { id: list, place, hidden: !shown });
      reloadMe();
    } catch (err) {
      setLocal(before);
      toast((err as Error).message, "alert");
    }
  }
  return { shown: (list: string, place: ListPlace) => shownIn(local, place, list), set };
}

/** De twee schakelaars voor één lijst (in ⋯ van de lijst). */
export function ListPlaceSwitches({ list }: { list: string }) {
  const places = useListPlaces();
  return (
    <div className="sheet-switches">
      {(Object.keys(LIST_PLACES) as ListPlace[]).map((p) => (
        <Switch key={p} label={LIST_PLACES[p]} checked={places.shown(list, p)} onChange={(on) => places.set(list, p, on)} />
      ))}
    </div>
  );
}
