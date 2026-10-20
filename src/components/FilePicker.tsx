import { useRef } from "react";
import { formatBytes } from "../format";
import { Icon } from "./Icon";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf";

/** Twee knoppen: rechtstreeks de camera openen, of een bestaand bestand kiezen. */
export function FilePicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function add(list: FileList | null) {
    if (list) onChange([...files, ...Array.from(list)]);
  }

  return (
    <div className="file-picker">
      <div className="btn-row">
        <button type="button" className="btn btn-outline" onClick={() => cameraRef.current?.click()}>
          <Icon name="camera" /> Foto nemen
        </button>
        <button type="button" className="btn btn-outline" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" /> Bestand kiezen
        </button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`}>
              <Icon name={file.type.startsWith("image/") ? "image" : "file"} size={16} />
              <span className="file-name">{file.name}</span>
              <span className="muted small">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                aria-label={`${file.name} verwijderen`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <Icon name="close" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
