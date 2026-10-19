export type AppEnv = {
  Bindings: Env & { DEV_USER?: string };
  Variables: { user: string };
};
