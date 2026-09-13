import { existsSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../db.js";
import { startRecallQualificationEpoch } from "./recall-qualification-epoch.js";

const [dbPath, readyPath, gatePath, resultPath, startRequestKey, expectedCurrentEpochId] =
  process.argv.slice(2);

const db = openNuclearDb(new DatabaseSync(dbPath), { continuityOptional: true });
try {
  db.exec("PRAGMA busy_timeout = 10000");
  writeFileSync(readyPath, "ready", "utf8");
  while (!existsSync(gatePath)) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const result = startRecallQualificationEpoch(db, {
    authorizedBy: "concurrency-test",
    startRequestKey,
    expectedCurrentEpochId,
  });
  writeFileSync(resultPath, JSON.stringify(result), "utf8");
} catch (error) {
  writeFileSync(
    resultPath,
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }),
    "utf8",
  );
} finally {
  db.close();
}
