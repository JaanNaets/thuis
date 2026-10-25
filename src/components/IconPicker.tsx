import { ICONS, type IconKey } from "../../shared/templates";
import { Icon, type IconName } from "./Icon";

/** Een icoon kiezen voor een project of lijst: een raster van knoppen (radio's). */
export function IconPicker({ value, onChange, label = "Icoon" }: { value: IconKey | null; onChange: (icon: IconKey) => void; label?: string }) {
  return (
    <div className="icon-picker" role="radiogroup" aria-label={label}>
      {ICONS.map((icon) => (
        <button key={icon} type="button" role="radio" aria-checked={value === icon} aria-label={icon} className="icon-option" onClick={() => onChange(icon)}>
          <Icon name={icon as IconName} size={17} />
        </button>
      ))}
    </div>
  );
}
