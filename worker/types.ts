import type { Person } from "../shared/types";

export type AppEnv = {
  Bindings: Env & { DEV_USER?: string };
  Variables: {
    /** E-mailadres van wie aangemeld is (uit Cloudflare Access). */
    user: string;
    /** De persoon bij dat e-mailadres (zie context.ts). */
    person: Person;
  };
};
