import type { Member } from "../shared/types";

export type AppEnv = {
  Bindings: Env & { DEV_USER?: string };
  Variables: {
    /** E-mailadres van wie aangemeld is (uit Cloudflare Access). */
    user: string;
    /** Het huishouden van deze aanvraag (zie context.ts). */
    household: string;
    /** Het lid dat de aanvraag doet, in dat huishouden. */
    member: Member;
    /** true = toegang tot alles in het huishouden; false = enkel de eigen projecten. */
    full: boolean;
  };
};
