import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import type { Mailer } from "./services/mail.js";
import type { FileStorage } from "./services/storage.js";

export type PlatformRole = "admin" | "instructor" | "student";

export interface SessionUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: PlatformRole;
}

/** Another system calling the API with a service token: the registrar sync, not a person. */
export interface ServiceCaller {
  id: string;
  orgId: string;
  label: string;
}

export interface AppContext {
  db: Db;
  config: Config;
  storage: FileStorage;
  mailer: Mailer;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    user: SessionUser | null;
    authSession: { id: string; csrfToken: string } | null;
    service: ServiceCaller | null;
  }
}
