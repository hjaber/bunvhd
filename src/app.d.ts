// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type {
  CfProperties,
  ExecutionContext,
  Hyperdrive,
} from "@cloudflare/workers-types";

declare global {
  namespace App {
    interface Platform {
      env: Env;
      cf: CfProperties;
      ctx: ExecutionContext;
    }
    interface Env {
      "CACHED-DB-BUNVHD": Hyperdrive;
      "NO-CACHED-DB-BUNVHD": Hyperdrive;
      "CACHED-DB-BUNVHD-US-EAST": Hyperdrive;
      "NO-CACHED-DB-BUNVHD-US-EAST": Hyperdrive;
    }
  }
}

export {};
