import type { Executor } from "../db/client.js";
import { auditEvents } from "../db/schema.js";

export interface AuditInput {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  courseId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Record a sensitive administrative or grading action. */
export async function audit(db: Executor, e: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    actorId: e.actorId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    courseId: e.courseId ?? null,
    metadata: e.metadata ?? {},
    ip: e.ip ?? null,
  });
}
