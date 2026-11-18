// Iets dat openklapt (Hoe Heystack werkt): bovenaan één regel, met een tik de rest. Een gewone `details`, dus het
// werkt ook zonder JavaScript en met het toetsenbord. Zie STIJLBOEK.md → Uitklappen.

import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function Disclosure({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <details className="disclosure">
      <summary>
        <span className="disclosure-title">{title}</span>
        <Icon name="down" size={16} className="disclosure-chevron" />
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
