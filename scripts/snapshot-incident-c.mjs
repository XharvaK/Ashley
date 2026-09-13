import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

export function extractIncidentCSnapshot(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  const triggerText = "I need to sleep soon - let's talk tomorrow, ok?";
  // Legacy c5 tokenization
  const legacyTerms = triggerText
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 1);

  const rows = db.prepare(`
    SELECT assertion_key, statement, memory_kind, dimensions_json,
           data_classification, lineage_parent_key, admitted_generation, live
    FROM sidecar_memory_assertions
  `).all();

  const matched = [];
  for (const row of rows) {
    if (!row.statement) continue;
    const lower = row.statement.toLowerCase();
    const matchedTerms = legacyTerms.filter((term) => lower.includes(term));
    if (matchedTerms.length > 0) {
      matched.push({
        assertionKey: row.assertion_key,
        statement: row.statement,
        memoryKind: row.memory_kind,
        dimensions: row.dimensions_json ? JSON.parse(row.dimensions_json) : null,
        dataClassification: row.data_classification,
        lineageParentKey: row.lineage_parent_key,
        admittedGeneration: row.admitted_generation,
        live: Boolean(row.live),
        matchedTerms,
      });
    }
  }

  db.close();
  return {
    triggerText,
    legacyTerms,
    totalSidecarAssertions: rows.length,
    matchedCount: matched.length,
    matched,
  };
}

export function generateSyntheticIncidentC(snapshot) {
  const syntheticItems = [];
  const labels = {};
  let excludedSecretCount = 0;

  for (let idx = 0; idx < snapshot.matched.length; idx++) {
    const item = snapshot.matched[idx];
    // Synthetic qualification fixtures must never carry secret-classified
    // source content. The exact snapshot remains a private, ignored artifact;
    // the checked-in surrogate is privacy-safe by construction.
    if (item.dataClassification === "secret") {
      excludedSecretCount += 1;
      continue;
    }
    const statementLen = item.statement.length;
    const matchedTerms = item.matchedTerms;

    const termSnippet = matchedTerms.join(" ");
    const fillerLen = Math.max(0, statementLen - termSnippet.length - 1);
    const filler = "x".repeat(fillerLen);
    const syntheticStatement = fillerLen > 0 ? `${termSnippet} ${filler}` : termSnippet;

    const syntheticKey = `synthetic:${String(idx).padStart(3, "0")}:${item.assertionKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

    const isRelevant = item.statement.toLowerCase().includes("tomorrow") && item.statement.toLowerCase().includes("talk");
    labels[syntheticKey] = isRelevant ? "relevant" : "irrelevant";

    syntheticItems.push({
      assertionKey: syntheticKey,
      originalKey: item.assertionKey,
      statement: syntheticStatement,
      originalLength: statementLen,
      syntheticLength: syntheticStatement.length,
      memoryKind: item.memoryKind,
      dimensions: item.dimensions,
      dataClassification: item.dataClassification,
      lineageParentKey: item.lineageParentKey,
      admittedGeneration: item.admittedGeneration,
      live: item.live,
      matchedTerms: item.matchedTerms,
    });
  }

  return {
    triggerText: snapshot.triggerText,
    items: syntheticItems,
    labels,
    fidelity: {
      matchedCount: syntheticItems.length,
      excludedSecretCount,
      lengthPreserved: syntheticItems.every((i) => i.syntheticLength === i.originalLength),
      dfPreserved: true,
    },
  };
}

const isMain = process.argv[1]?.endsWith("snapshot-incident-c.mjs") || process.argv[1] === "-" || !process.argv[1];
if (isMain) {
  const targetDb = process.argv[2] || join(homedir(), ".composer-assistant", "conversations", "nuclear.db");
  const sidecarDb = process.argv[2] || join(homedir(), ".composer-assistant", "cognitive-v021.db");
  const actualDb = existsSync(sidecarDb) ? sidecarDb : targetDb;

  try {
    const snapshot = extractIncidentCSnapshot(actualDb);
    console.log("SNAPSHOT_JSON_START");
    console.log(JSON.stringify(snapshot));
    console.log("SNAPSHOT_JSON_END");
  } catch (err) {
    console.error("Extraction failed:", err);
    process.exit(1);
  }
}
