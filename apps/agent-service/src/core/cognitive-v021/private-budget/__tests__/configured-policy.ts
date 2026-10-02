// Historical fake-policy fixtures explicitly configure their Host-owned bounds.
import type { DatabaseSync } from "node:sqlite";
import { configureBudgetPolicy, DEFAULT_PRIVATE_THOUGHT_POLICY } from "../policies.js";
export function configurePrivateBudgetFixture(db: DatabaseSync): void {
  configureBudgetPolicy(db, { ...DEFAULT_PRIVATE_THOUGHT_POLICY, policyId: "private-v1", version: 1 });
}
