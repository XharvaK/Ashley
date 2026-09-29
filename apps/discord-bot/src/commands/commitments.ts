import type { ChatInputCommandInteraction } from "discord.js";
import {
  getRelationshipSummary,
  ownerTemporalControl,
  type TemporalControlKind,
  type TemporalControlOperation,
  type TemporalControlRecord,
} from "../agent-client.js";

function oneLine(value: unknown): string {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function dueLabel(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "no due time";
  return new Date(value).toISOString();
}

function renderRecord(record: TemporalControlRecord): string {
  const purpose = oneLine(record.purpose) || "(no purpose)";
  return `- ${record.kind}/${record.id} | ${record.status} | ${dueLabel(record.dueAtMs)} | ${purpose}`;
}

function renderTemporalList(records: NonNullable<Awaited<ReturnType<typeof ownerTemporalControl>>["records"]>): string {
  const groups: Array<[string, TemporalControlRecord[]]> = [
    ["Future triggers", records.futureTriggers],
    ["Subscriptions", records.subscriptions],
    ["Commitments", records.commitments],
    ["Directives", records.directives],
  ];
  const lines = ["Owner temporal work"];
  for (const [label, items] of groups) {
    lines.push("", `${label}:`);
    lines.push(...(items.length > 0 ? items.map(renderRecord) : ["- none"]));
  }
  return lines.join("\n").slice(0, 1900);
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const action = interaction.options.getString("action") as (TemporalControlOperation | "summary" | null);
  if (action && action !== "summary") {
    const kind = interaction.options.getString("kind") as TemporalControlKind | null;
    const id = interaction.options.getString("id") ?? undefined;
    const dueAtRaw = interaction.options.getString("due-at-ms");
    let dueAtMs: number | undefined;
    if (dueAtRaw !== null) {
      dueAtMs = Number(dueAtRaw);
      if (!Number.isSafeInteger(dueAtMs) || dueAtMs < 0) {
        const error = new Error("due-at-ms must be a non-negative safe integer") as Error & { code?: string };
        error.code = "bad_request";
        throw error;
      }
    }
    const purpose = interaction.options.getString("purpose");
    const result = await ownerTemporalControl({
      operation: action,
      ...(kind ? { kind } : {}),
      ...(id ? { id } : {}),
      ...(dueAtMs === undefined ? {} : { dueAtMs }),
      ...(purpose === null ? {} : { purpose }),
    });
    if (action === "list") {
      await interaction.editReply(result.records ? renderTemporalList(result.records) : "No temporal work.");
      return;
    }
    if (action === "inspect") {
      await interaction.editReply(JSON.stringify(result.record ?? result, null, 2).slice(0, 1900));
      return;
    }
    const label = [result.kind ?? kind ?? "unknown", result.id ?? id ?? "unknown"].join("/");
    await interaction.editReply(`${label}: ${result.acknowledgement ?? "completed"} | status=${result.status ?? "unknown"} | wake=${result.wakeState ?? "none"}`.slice(0, 1900));
    return;
  }
  const offset = interaction.options.getInteger("offset") ?? 0;
  const summary = await getRelationshipSummary(offset);
  const lines = [
    `Alex reminders: ${summary.docReminders}`,
    `Self commitments: ${summary.selfCommitments}`,
    `Mutual active: ${summary.mutualActive} (proposed: ${summary.mutualProposed})`,
    `Open tensions: ${summary.tensions}`,
    `Active withdrawals: ${summary.withdrawals}`,
    "",
    ...summary.items.map((item) => `- [${item.kind}/${item.status}] ${item.text}`),
  ];
  await interaction.editReply(lines.join("\n").slice(0, 1900));
}
