import type { DatabaseSync } from "node:sqlite";

const ARTIFACT_COLUMNS = [
  "integrity_proof_json",
  "provenance_json",
  "preserved",
] as const;

export const MIGRATION_45_ARTIFACT_PRESERVATION_DDL = `
ALTER TABLE perception_artifacts
  ADD COLUMN integrity_proof_json TEXT
    CHECK (integrity_proof_json IS NULL OR json_valid(integrity_proof_json));
ALTER TABLE perception_artifacts
  ADD COLUMN provenance_json TEXT
    CHECK (provenance_json IS NULL OR json_valid(provenance_json));
ALTER TABLE perception_artifacts
  ADD COLUMN preserved INTEGER NOT NULL DEFAULT 0 CHECK (preserved IN (0, 1));
`;

function tableInfo(db: DatabaseSync): Array<{
  name?: string;
  notnull?: number;
  dflt_value?: string | null;
}> {
  return db.prepare("PRAGMA table_info(perception_artifacts)").all() as Array<{
    name?: string;
    notnull?: number;
    dflt_value?: string | null;
  }>;
}

function hasColumn(db: DatabaseSync, name: string): boolean {
  return tableInfo(db).some((column) => column.name === name);
}

/** Idempotent installer used by the nuclear migration protocol and fixtures. */
export function ensureNuclearV45Schema(db: DatabaseSync): void {
  if (!hasColumn(db, "integrity_proof_json")) {
    db.exec(
      "ALTER TABLE perception_artifacts ADD COLUMN integrity_proof_json TEXT CHECK (integrity_proof_json IS NULL OR json_valid(integrity_proof_json))",
    );
  }
  if (!hasColumn(db, "provenance_json")) {
    db.exec(
      "ALTER TABLE perception_artifacts ADD COLUMN provenance_json TEXT CHECK (provenance_json IS NULL OR json_valid(provenance_json))",
    );
  }
  if (!hasColumn(db, "preserved")) {
    db.exec(
      "ALTER TABLE perception_artifacts ADD COLUMN preserved INTEGER NOT NULL DEFAULT 0 CHECK (preserved IN (0, 1))",
    );
  }
}

export function validateNuclearV45Schema(db: DatabaseSync, version = 45): void {
  const columns = tableInfo(db);
  for (const name of ARTIFACT_COLUMNS) {
    if (!columns.some((column) => column.name === name)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:missing_column:perception_artifacts.${name}`);
    }
  }
  const preserved = columns.find((column) => column.name === "preserved");
  if (preserved?.notnull !== 1 || preserved.dflt_value !== "0") {
    throw new Error(`nuclear_schema_content_invalid:v${version}:invalid_column:perception_artifacts.preserved`);
  }
}
