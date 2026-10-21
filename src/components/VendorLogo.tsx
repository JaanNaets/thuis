import type { Vendor } from "../../shared/types";
import { VENDOR_KINDS } from "../../shared/vendor";
import { apiUrl } from "../api";
import { Icon, type IconName } from "./Icon";

const KIND_ICONS: Record<keyof typeof VENDOR_KINDS, IconName> = {
  store: "store",
  webshop: "globe",
  craftsman: "sliders",
  service: "idCard",
  private: "user",
};

/**
 * Het logo van een verkoper in het vierkantje van een rij (`row-media`), of het icoon van de soort.
 * Het adres bevat de versie, zodat een nieuw logo meteen verschijnt en een oud lang in de cache mag blijven.
 */
export function VendorLogo({ vendor, size = 17, className = "" }: { vendor: Pick<Vendor, "id" | "kind" | "logo_version">; size?: number; className?: string }) {
  if (vendor.logo_version) {
    return (
      <span className={`row-media vendor-logo ${className}`}>
        <img src={apiUrl(`/vendors/${vendor.id}/logo?v=${vendor.logo_version}`)} alt="" loading="lazy" />
      </span>
    );
  }
  return (
    <span className={`row-media ${className}`}>
      <Icon name={vendor.kind ? KIND_ICONS[vendor.kind] : "store"} size={size} />
    </span>
  );
}
