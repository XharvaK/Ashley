#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { runHealthAudit } from "./audit-health.mjs";
import { runMintDocsAudit } from "./audit-mint-docs.mjs";
import { runResourceAudit } from "./audit-resources.mjs";

export function run10cAudits() {
  return {
    health: runHealthAudit(),
    resources: runResourceAudit(),
    mintDocs: runMintDocsAudit(),
    backup: "verified by apps/agent-service wave10c.test.ts using temporary databases",
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check-only") {
    console.error("usage: node scripts/stabilization/audit-10c.mjs --check-only");
    process.exit(2);
  }
  try {
    console.log(`Wave 10c assurance audits passed: ${JSON.stringify(run10cAudits())}`);
  } catch (error) {
    console.error(`Wave 10c assurance audits failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
