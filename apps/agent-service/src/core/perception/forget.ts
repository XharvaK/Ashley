import type { DatabaseSync } from "node:sqlite";
import type { ForgetTarget } from "../continuity/forget-preview.js";

function tableExists(db: DatabaseSync, name: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`,
      )
      .get(name) !== undefined
  );
}

export function listPerceptionForgetTargets(
  db: DatabaseSync,
  ownerId: string,
  topic: string,
): { targets: ForgetTarget[]; preview: string[] } {
  const needle = topic.trim().toLowerCase();
  if (!needle) return { targets: [], preview: [] };
  const targets: ForgetTarget[] = [];
  const preview: string[] = [];

  if (tableExists(db, "perception_artifacts")) {
    const rows = db
      .prepare(
        `SELECT entity_uuid, excerpt, discord_attachment_id
         FROM perception_artifacts
         WHERE owner_id = ?
           AND status NOT IN ('redacted', 'expired')
           AND (
             LOWER(COALESCE(excerpt, '')) LIKE ?
             OR LOWER(COALESCE(mime_declared, '')) LIKE ?
             OR LOWER(COALESCE(discord_attachment_id, '')) LIKE ?
           )`,
      )
      .all(ownerId, `%${needle}%`, `%${needle}%`, `%${needle}%`) as Array<{
      entity_uuid?: string;
      excerpt?: string | null;
      discord_attachment_id?: string;
    }>;
    for (const row of rows) {
      const entityUuid = String(row.entity_uuid ?? "");
      if (!entityUuid) continue;
      targets.push({
        entityType: "perception_artifact",
        entityUuid,
        action: "redact",
      });
      preview.push(
        `attachment:${String(row.discord_attachment_id ?? entityUuid)} ${String(row.excerpt ?? "").slice(0, 80)}`,
      );
    }
  }

  if (tableExists(db, "conversational_reads")) {
    const rows = db
      .prepare(
        `SELECT entity_uuid, title, excerpt, requested_url_fingerprint
         FROM conversational_reads
         WHERE owner_id = ?
           AND status NOT IN ('redacted', 'expired')
           AND (
             LOWER(COALESCE(title, '')) LIKE ?
             OR LOWER(COALESCE(excerpt, '')) LIKE ?
           )`,
      )
      .all(ownerId, `%${needle}%`, `%${needle}%`) as Array<{
      entity_uuid?: string;
      title?: string | null;
      excerpt?: string | null;
      requested_url_fingerprint?: string;
    }>;
    for (const row of rows) {
      const entityUuid = String(row.entity_uuid ?? "");
      if (!entityUuid) continue;
      if (
        targets.some(
          (target) =>
            target.entityType === "conversational_read" &&
            target.entityUuid === entityUuid,
        )
      ) {
        continue;
      }
      targets.push({
        entityType: "conversational_read",
        entityUuid,
        action: "redact",
      });
      preview.push(
        `read:${String(row.title ?? row.requested_url_fingerprint ?? entityUuid).slice(0, 120)}`,
      );
    }
  }

  return { targets, preview };
}

export function redactPerceptionTargets(
  db: DatabaseSync,
  ownerId: string,
  targets: ForgetTarget[],
): number {
  let changed = 0;
  const now = new Date().toISOString();
  for (const target of targets) {
    switch (target.entityType) {
      case "perception_artifact":
        if (!tableExists(db, "perception_artifacts")) break;
        changed += Number(
          db
            .prepare(
              `UPDATE perception_artifacts
               SET status = 'redacted',
                   excerpt = NULL,
                   model_parts_json = '[]',
                   model_representation = 'none',
                   content_hash = NULL,
                   error_code = 'forgotten',
                   updated_at = ?
               WHERE entity_uuid = ? AND owner_id = ?`,
            )
            .run(now, target.entityUuid, ownerId).changes,
        );
        break;
      case "conversational_read":
        if (!tableExists(db, "conversational_reads")) break;
        changed += Number(
          db
            .prepare(
              `UPDATE conversational_reads
               SET status = 'redacted',
                   title = NULL,
                   excerpt = NULL,
                   model_parts_json = '[]',
                   model_representation = 'none',
                   content_hash = NULL,
                   error_code = 'forgotten',
                   updated_at = ?
               WHERE entity_uuid = ? AND owner_id = ?`,
            )
            .run(now, target.entityUuid, ownerId).changes,
        );
        break;
      default:
        break;
    }
  }
  return changed;
}

export function redactPerceptionByOwnerTopic(
  db: DatabaseSync,
  ownerId: string,
  topic: string,
): number {
  const { targets } = listPerceptionForgetTargets(db, ownerId, topic);
  return redactPerceptionTargets(db, ownerId, targets);
}
