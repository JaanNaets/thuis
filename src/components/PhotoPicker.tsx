// Een foto nemen of kiezen (zie STIJLBOEK.md → Fotokiezer): op een gsm of tablet Camera of Foto's (Android opent bij
// een gewone fotoknop meteen de fotobibliotheek, zonder camera), en of de AI ze leest (✨). De schakelaar staat zoals
// het formulier het wil (Instellen); de AI leest pas na jouw keuze. Zonder AI en zonder touchscherm: meteen het
// bestandsvenster.

import { useRef, useState, type ReactNode } from "react";
import { isTouch } from "../device";
import { Switch } from "./Controls";
import { AiMark } from "./Fields";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./Sheet";

/**
 * `read`: null = hier leest niemand (de AI staat uit, of het formulier leest geen foto's); anders hoe de schakelaar
 * begint. `onPhoto` krijgt de foto en of de AI ze moet lezen.
 */
export function PhotoButton({
  read,
  busy = false,
  onPhoto,
  children = "Foto",
  className = "btn btn-outline btn-sm",
}: {
  read: boolean | null;
  busy?: boolean;
  onPhoto: (file: File, read: boolean) => void;
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pick = usePhotoInputs((file) => onPhoto(file, read !== null && reading));
  const [reading, setReading] = useState(read ?? false);
  const touch = isTouch();

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => {
          setReading(read ?? false);
          if (read === null && !touch) pick.library();
          else setOpen(true);
        }}
      >
        <Icon name="camera" size={15} /> {children}
        {read !== null && <AiMark />}
      </button>
      {pick.inputs}
      <PhotoSheet
        open={open}
        touch={touch}
        read={read === null ? null : reading}
        onRead={setReading}
        onClose={() => setOpen(false)}
        onCamera={() => (setOpen(false), pick.camera())}
        onLibrary={() => (setOpen(false), pick.library())}
      />
    </>
  );
}

/** Twee verborgen invoervelden: de camera (`capture`) en de fotokiezer van het toestel. */
export function usePhotoInputs(onFile: (file: File) => void) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onFile(file);
  };
  return {
    camera: () => camera.current?.click(),
    library: () => library.current?.click(),
    inputs: (
      <>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={take} />
        <input ref={library} type="file" accept="image/*" hidden onChange={take} />
      </>
    ),
  };
}

/** Het blad: Camera en Foto's (of op een computer: Foto kiezen), met de schakelaar Lezen met AI. */
export function PhotoSheet({
  open,
  touch,
  read,
  onRead,
  onClose,
  onCamera,
  onLibrary,
}: {
  open: boolean;
  touch: boolean;
  read: boolean | null;
  onRead: (on: boolean) => void;
  onClose: () => void;
  onCamera: () => void;
  onLibrary: () => void;
}) {
  const row = (icon: IconName, label: string, run: () => void) => (
    <li key={label}>
      <button type="button" className="row" onClick={run}>
        <span className="cell-main">
          <span className="row-media">
            <Icon name={icon} size={16} />
          </span>
          <span className="row-title">{label}</span>
        </span>
      </button>
    </li>
  );
  return (
    <Sheet open={open} title="Foto" onClose={onClose}>
      <ul className="rows sheet-menu">{touch ? [row("camera", "Camera", onCamera), row("image", "Foto's", onLibrary)] : row("image", "Foto kiezen", onLibrary)}</ul>
      {read !== null && (
        <div className="photo-read">
          <Switch
            checked={read}
            onChange={onRead}
            label={
              <>
                Lezen met AI <AiMark />
              </>
            }
          />
        </div>
      )}
    </Sheet>
  );
}
