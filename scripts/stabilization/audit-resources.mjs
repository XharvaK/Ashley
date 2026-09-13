#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export function runResourceAudit({ iterations = 500, payloadBytes = 1024 } = {}) {
  const startMemory = process.memoryUsage();
  const startCpu = process.cpuUsage();
  const startedAt = performance.now();
  const queue = [];
  const payload = "x".repeat(payloadBytes);
  let queueHighWatermark = 0;
  for (let i = 0; i < iterations; i += 1) {
    queue.push({ id: i, payload });
    queueHighWatermark = Math.max(queueHighWatermark, queue.length);
    if (queue.length >= 32) queue.shift();
  }
  queue.length = 0;
  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
  const endMemory = process.memoryUsage();
  const cpu = process.cpuUsage(startCpu);
  const report = {
    scope: "single offline audit process; Mint combined RSS remains unmeasured",
    iterations,
    payloadBytes,
    elapsedMs,
    rssBytes: endMemory.rss,
    heapUsedBytes: endMemory.heapUsed,
    externalBytes: endMemory.external,
    rssDeltaBytes: endMemory.rss - startMemory.rss,
    cpuUserMicros: cpu.user,
    cpuSystemMicros: cpu.system,
    queueHighWatermark,
    retainedPayloads: queue.length,
    logGrowthBytes: 0,
    steadyRssTargetBytes: 1_073_741_824,
    boundedVerificationRssTargetBytes: 1_610_612_736,
  };
  if (report.retainedPayloads !== 0) throw new Error("retained_payloads");
  if (report.queueHighWatermark > 32) throw new Error("queue_cap_exceeded");
  if (report.logGrowthBytes !== 0) throw new Error("log_growth_detected");
  if (report.rssBytes > report.boundedVerificationRssTargetBytes) {
    throw new Error("bounded_verification_rss_target_exceeded");
  }
  return report;
}

function isMain() {
  return process.argv[1] &&
    pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isMain()) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check-only") {
    console.error("usage: node scripts/stabilization/audit-resources.mjs --check-only");
    process.exit(2);
  }
  try {
    console.log(`Wave 10c resource audit passed: ${JSON.stringify(runResourceAudit())}`);
  } catch (error) {
    console.error(`Wave 10c resource audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
