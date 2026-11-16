declare module 'virtual:himlio/config' {
  import type { HimlioFacts } from './config.js';
  export const facts: HimlioFacts;
  export const modelMigrations: { name: string; seed: unknown }[];
  export const siteCrons: Record<
    string,
    (controller: ScheduledController, env: unknown, ctx: ExecutionContext) => void | Promise<void>
  >;
}
