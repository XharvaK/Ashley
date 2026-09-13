import { DatabaseSync } from "node:sqlite";

export function verifyFts5Capability() {
  const db = new DatabaseSync(":memory:");
  const sqliteVer = db.prepare("SELECT sqlite_version() as v").get().v;
  console.log(`SQLite version: ${sqliteVer}`);

  // Create virtual table using FTS5 and unicode61 with remove_diacritics 1
  db.exec(`
    CREATE VIRTUAL TABLE memory_fts USING fts5(
      assertion_key UNINDEXED,
      statement,
      memory_kind UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 1'
    );
  `);

  // Insert sample test rows
  const insertStmt = db.prepare(`
    INSERT INTO memory_fts (assertion_key, statement, memory_kind)
    VALUES (?, ?, ?)
  `);

  const samples = [
    { key: "k1", statement: "The HY3 engine is deployed on M4 hardware with GPT and LLM API support", kind: "system" },
    { key: "k2", statement: "Qwen model handles multilingual text like 中文 and こんにちは nicely", kind: "system" },
    { key: "k3", statement: "Special Turkish characters: ğüşıöç and café résumé diacritics", kind: "system" },
    { key: "k4", statement: "Let's test contractions: it's working and don't fail", kind: "system" },
  ];

  for (const sample of samples) {
    insertStmt.run(sample.key, sample.statement, sample.kind);
  }

  // FTS5 integrity check
  db.exec("INSERT INTO memory_fts(memory_fts) VALUES('integrity-check');");
  const pragmaIntegrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
  if (pragmaIntegrity !== "ok") {
    throw new Error(`PRAGMA integrity_check failed: ${pragmaIntegrity}`);
  }
  console.log("FTS5 integrity check: OK");

  // Probes
  const matchStmt = db.prepare(`
    SELECT assertion_key, statement, rank
    FROM memory_fts
    WHERE memory_fts MATCH ?
    ORDER BY rank
  `);

  function testQuery(query, expectedKey) {
    const rows = matchStmt.all(query);
    const found = rows.some((r) => r.assertion_key === expectedKey);
    console.log(`Query '${query}' -> ${rows.length} hits (expected key '${expectedKey}' present: ${found})`);
    if (!found) {
      throw new Error(`FTS5 probe failed: '${query}' did not match expected '${expectedKey}'`);
    }
    return rows;
  }

  // Technical tokens (case-insensitive MATCH)
  testQuery('"HY3"', "k1");
  testQuery('"hy3"', "k1");
  testQuery('"M4"', "k1");
  testQuery('"GPT"', "k1");
  testQuery('"LLM"', "k1");
  testQuery('"API"', "k1");
  testQuery('"Qwen"', "k2");
  testQuery('"qwen"', "k2");

  // Diacritics
  testQuery('"cafe"', "k3");
  testQuery('"café"', "k3");
  testQuery('"resume"', "k3");
  testQuery('"résumé"', "k3");

  // Multilingual
  testQuery('"中文"', "k2");
  testQuery('"こんにちは"', "k2");

  // Contraction words
  testQuery('"test"', "k4");

  db.close();
  console.log("All FTS5 capability probes passed successfully.");
  return {
    sqliteVersion: sqliteVer,
    fts5Available: true,
    unicode61Available: true,
    integrityCheck: true,
  };
}

try {
  const result = verifyFts5Capability();
  console.log("VERIFY_FTS5_RESULT:", JSON.stringify(result));
} catch (err) {
  console.error("VERIFY_FTS5_FAILED:", err);
  process.exit(1);
}
