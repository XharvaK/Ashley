import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { ConversationLogger } from "./conversation-logger.js";
import { AshleyCore } from "./core/index.js";
import type { DataPlaneContext } from "./core/data-plane.js";
import { openNuclearDb } from "./core/db.js";
import { env, validateBoot } from "./env.js";
import { AppError } from "./errors.js";
import { isAuthorizedOwnerId } from "./owner-auth.js";
import { DatabaseSync } from "node:sqlite";
import {
  openCognitiveSidecarDb,
} from "./core/cognitive-v021/sidecar/db.js";
import {
  isPeriodicCognitionEnabled,
  runLiveCognitiveTurn,
} from "./core/cognitive-v021/dispatch/live.js";
import { reconcileProjectedDelivery } from "./core/cognitive-v021/delivery/outbox-projector.js";
import { readCognitiveSidecarMeta } from "./core/cognitive-v021/sidecar/db.js";
import { appendInboxEvent, claimInboxEvent } from "./core/cognitive-v021/cycle/inbox.js";
import { consumeInboxEvent } from "./core/cognitive-v021/cycle/inbox-consumer.js";
import { DURABLE_WORK_COORDINATION_LEASE_MS } from "./core/cognitive-v021/retry/ledger.js";
import {
  tickIdleOpportunity,
  type IdleObservationDraft,
  type IdleTickResult,
} from "./core/cognitive-v021/initiative/idle.js";
import { detectCredentialShape, CREDENTIAL_OMITTED_PLACEHOLDER } from "./core/privacy/secrets.js";
import { scanConfiguredSources } from "./core/curiosity/sources.js";
import { performGroundedReads, type ReadRecord } from "./core/curiosity/reads.js";
import { resolveActiveThread } from "./core/memory/threads.js";
import type {
  CognitiveDispatchResult,
  InboxEvent,
  KernelDeps,
  OutboxDeliveryProjector,
} from "./core/cognitive-v021/types.js";
import { resolveDispatchPolicy } from "./core/model-fabric/activation.js";
import type { CurrentPolicyResolutionInput } from "./core/model-fabric/portfolio.js";
import { routeReady } from "./core/model-routing/router.js";

export type { CognitiveDispatchResult };

export class BootValidationError extends Error {
  readonly code = "boot_validation_failed";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Boot configuration invalid: ${errors.join("; ")}`);
    this.name = "BootValidationError";
    this.errors = errors;
  }
}

export type AgentState = "booting" | "ready" | "paused" | "busy" | "offline";

export type ProviderState = "configured" | "degraded" | "unavailable";

export type ReadinessSnapshot = Readonly<{
  bootValidationSucceeded: boolean;
  kernelInitialized: boolean;
  activeConversationConfigured: boolean;
  shadowFabricConfigured: boolean | "NOT_APPLICABLE";
  utilityRoleConfiguration: Readonly<{
    exchangeCognition: boolean;
    curiosityConsolidation: boolean;
  }>;
  providerRemoteAvailability: "UNKNOWN";
}>;

export type SseClient = {
  write: (data: object) => void;
};

export function readRecordToObservationDraft(read: ReadRecord): IdleObservationDraft | null {
  if (read.provenance !== "live") return null;
  const credential = detectCredentialShape(
    `${read.finalUrl}\n${read.title}\n${read.evidenceExcerpts.join("\n")}`,
  ).hit;
  const identity = `curiosity:read:${read.id}:${read.contentHash.trim().toLowerCase()}`;
  return {
    observationId: identity,
    derived: true,
    replaySafe: true,
    modality: "page",
    payload: {
      readId: read.id,
      itemId: read.itemId,
      finalUrl: credential ? CREDENTIAL_OMITTED_PLACEHOLDER : read.finalUrl,
      contentHash: read.contentHash,
      retrievedAt: read.retrievedAt,
      title: credential ? CREDENTIAL_OMITTED_PLACEHOLDER : read.title,
      excerpts: credential ? [] : read.evidenceExcerpts.slice(0, 6),
      inputTrust: "untrusted_evidence",
    },
    provenance: identity,
    dataClassification: credential ? "secret" : "ordinary",
    secretOmitted: credential,
  };
}

type PersistedState = {
  activeSessionId?: string | null;
};

export class AgentManager {
  private state: AgentState = "booting";
  readonly logger: ConversationLogger;
  readonly core: AshleyCore;
  readonly dataPlane: DataPlaneContext;
  private cognitiveSidecar: DatabaseSync | null = null;
  private cognitiveDeps: KernelDeps | null = null;
  private cognitiveProjector: OutboxDeliveryProjector | undefined;
  private sseClients = new Set<SseClient>();
  private readonly bootedAt = Date.now();
  private bootValidationSucceeded = false;
  private startupComplete = false;
  private expressionEnabled = false;

  constructor(dataPlane: DataPlaneContext, existingNuclear?: DatabaseSync) {
    this.dataPlane = dataPlane;
    mkdirSync(dataPlane.dataDir, { recursive: true });
    mkdirSync(dataPlane.conversationsDir, { recursive: true });
    this.logger = new ConversationLogger(dataPlane);
    const db =
      existingNuclear ??
      openNuclearDb(new DatabaseSync(dataPlane.nuclearDbPath), {
        dataPlane,
        migrate: true,
      });
    this.core = new AshleyCore(db, { dataPlane });
  }

  getState(): AgentState {
    return this.state;
  }

  getCognitiveKernel(): "v021" {
    return "v021";
  }

  /** Open the sole current V0.2.1 cognitive sidecar. */
  openCognitiveSidecar(): DatabaseSync {
    if (this.cognitiveSidecar) return this.cognitiveSidecar;
    this.cognitiveSidecar = openCognitiveSidecarDb(
      new DatabaseSync(this.dataPlane.cognitiveSidecarDbPath),
      { dataPlane: this.dataPlane },
    );
    return this.cognitiveSidecar;
  }

  getCognitiveSidecar(): DatabaseSync | null {
    return this.cognitiveSidecar;
  }

  /** Bind the current V0.2.1 worker dependencies after stores are open. */
  configureCognitiveDispatch(input: {
    deps: KernelDeps;
    projector?: OutboxDeliveryProjector;
  }): void {
    this.cognitiveDeps = input.deps;
    this.expressionEnabled = input.deps.expressionEnabled === true;
    this.cognitiveProjector = input.projector;
  }

  /** Dispatch through the sole current V0.2.1 cognitive kernel. */
  async dispatchCognitiveEvent(event: InboxEvent): Promise<CognitiveDispatchResult> {
    const sidecar = this.openCognitiveSidecar();
    const deps = this.cognitiveDeps;
    if (!sidecar || !deps) throw new AppError("agent_not_ready", "Cognitive dispatcher unavailable", 503);
    return runLiveCognitiveTurn({
      sidecar,
      nuclear: this.core.getDatabase(),
      event,
      deps,
      projector: this.cognitiveProjector,
    });
  }

  /** Run one private idle opportunity through the same durable inbox/kernel path. */
  async tickCognitiveIdle(ownerId: string): Promise<IdleTickResult> {
    const sidecar = this.openCognitiveSidecar();
    if (!sidecar || !this.cognitiveDeps) {
      throw new AppError("agent_not_ready", "Cognitive dispatcher unavailable", 503);
    }
    const nuclear = this.core.getDatabase();
    const conversationId = resolveActiveThread(nuclear, ownerId, "discord");
    const authorityEpoch = readCognitiveSidecarMeta(sidecar).authority_epoch;
    return tickIdleOpportunity(sidecar, {
      conversationId,
      occupantId: ownerId,
      authorityEpoch,
      periodicCognitionEnabled: isPeriodicCognitionEnabled(),
      curiosityObservationProvider: async () => {
        try { await scanConfiguredSources(nuclear); } catch { /* mechanical acquisition must not block Thought */ }
        try {
          const result = await performGroundedReads(nuclear, ownerId);
          return result.reads
            .filter((read) => read.provenance === "live")
            .map(readRecordToObservationDraft)
            .filter((observation): observation is IdleObservationDraft => observation !== null);
        } catch {
          return [];
        }
      },
      runThought: async (input) => {
        const event = input.event ?? appendInboxEvent(sidecar, {
          id: `idle:${input.wakeId}`,
          wakeId: input.wakeId,
          conversationId: input.cycle.conversationId,
          kind: input.trigger.kind,
          payload: {
            ownerId,
            channel: "discord",
            threadId: input.cycle.conversationId,
            triggerRef: input.trigger.ref,
            cycleId: input.cycle.cycleId,
            generation: input.cycle.generation,
            privateBudgetReservationId: input.privateBudgetReservation.reservationId,
            occupantId: ownerId,
            observations: input.observations,
            dueTriggers: input.dueTriggers.map((trigger) => trigger.triggerId),
          },
          createdAtMs: Date.now(),
        });
        const claimed = claimInboxEvent(sidecar, {
          eventId: event.id,
          workerId: `idle:${process.pid}:${ownerId}`,
          nowMs: Date.now(),
          leaseMs: DURABLE_WORK_COORDINATION_LEASE_MS,
        });
        if (!claimed) throw new Error("idle_inbox_claim_failed");
        let result: CognitiveDispatchResult = null;
        await consumeInboxEvent(sidecar, claimed, async () => {
          result = await this.dispatchCognitiveEvent(claimed);
          return result;
        });
        const dispatched = result as CognitiveDispatchResult;
        return {
          ...(dispatched ?? {}),
          speechMode: dispatched === null || dispatched.outboxId == null ? "none" as const : "draft" as const,
        };
      },
    });
  }

  /** Trusted host state used by guarded C1 currentness activation. */
  isPaused(): boolean {
    return this.state === "paused";
  }

  getAgentId(): string | null {
    return null;
  }

  getUptimeSec(): number {
    return Math.floor((Date.now() - this.bootedAt) / 1000);
  }

  isMistralConfigured(): boolean {
    return Boolean(env.mistralApiKey);
  }

  getProviderState(): ProviderState {
    return this.activeConversationPathConfigured() ? "configured" : "unavailable";
  }

  getReadinessSnapshot(): ReadinessSnapshot {
    return {
      bootValidationSucceeded: this.bootValidationSucceeded,
      kernelInitialized: this.startupComplete,
      activeConversationConfigured: this.activeConversationPathConfigured(),
      shadowFabricConfigured: "NOT_APPLICABLE",
      utilityRoleConfiguration: {
        exchangeCognition: routeReady("utility_bulk"),
        curiosityConsolidation: routeReady("utility_bulk"),
      },
      providerRemoteAvailability: "UNKNOWN",
    };
  }

  addSseClient(client: SseClient): void {
    this.sseClients.add(client);
  }

  removeSseClient(client: SseClient): void {
    this.sseClients.delete(client);
  }

  broadcast(event: object): void {
    for (const c of this.sseClients) {
      try {
        c.write(event);
      } catch {
        this.sseClients.delete(c);
      }
    }
  }

  private loadState(): PersistedState {
    if (!existsSync(this.dataPlane.statePath)) return {};
    return JSON.parse(readFileSync(this.dataPlane.statePath, "utf-8")) as PersistedState;
  }

  private saveState(patch: Partial<PersistedState>): void {
    const prev = this.loadState();
    writeFileSync(this.dataPlane.statePath, JSON.stringify({ ...prev, ...patch }, null, 2));
  }

  private providerCredentialPresent(provider: string): boolean {
    switch (provider) {
      case "mistral":
        return Boolean(env.mistralApiKey);
      case "groq":
        return Boolean(env.groqApiKey);
      case "nim":
        return Boolean(env.nimApiKey);
      case "cloudflare":
        return Boolean(env.cloudflareApiToken && env.cloudflareAccountId);
      case "opencode_zen":
        return Boolean(env.opencodeZenApiKey);
      default:
        return false;
    }
  }

  private thoughtFabricConfigured(): boolean {
    const policyInput: CurrentPolicyResolutionInput = {
      logicalRole: "thought",
      purpose: "thought",
      lane: "urgent_grounded",
      deadlineAtMs: Date.now() + 60_000,
      routeId: "thought",
    };
    try {
      const currentPolicy = resolveDispatchPolicy(policyInput);
      if (currentPolicy.source === "fail_closed") return false;
      if (currentPolicy.source === "current_compatibility") {
        return routeReady("thought");
      }
      return this.providerCredentialPresent(currentPolicy.occupant.provider);
    } catch {
      return false;
    }
  }

  private activeConversationPathConfigured(): boolean {
    if (!this.thoughtFabricConfigured()) return false;
    return !this.expressionEnabled || routeReady("ashley_expression");
  }

  private readinessSatisfied(): boolean {
    return this.bootValidationSucceeded && this.startupComplete && this.activeConversationPathConfigured();
  }

  async init(): Promise<void> {
    this.startupComplete = false;
    const { ok, errors, warnings } = validateBoot();
    for (const w of warnings) console.warn(`[agent-service] ${w}`);
    if (!ok) {
      this.bootValidationSucceeded = false;
      for (const e of errors) console.error(`[agent-service] FATAL ${e}`);
      this.state = "offline";
      this.broadcast({ type: "offline", reason: "invalid_configuration" });
      throw new BootValidationError(errors);
    }
    this.bootValidationSucceeded = true;
    if (!this.activeConversationPathConfigured()) {
      this.state = "offline";
      this.broadcast({ type: "offline", reason: "missing_provider_configuration" });
      return;
    }
    this.state = "booting";
    this.broadcast({ type: "status", status: "booting" });
  }

  markStartupComplete(): void {
    this.startupComplete = true;
    this.state = this.readinessSatisfied() ? "ready" : "offline";
    this.broadcast({ type: "status", status: this.state });
  }

  async pause(): Promise<void> {
    this.state = "paused";
    this.broadcast({ type: "status", status: "paused" });
  }

  async resume(): Promise<void> {
    this.state = this.readinessSatisfied() ? "ready" : "offline";
    this.broadcast({ type: "status", status: this.state });
  }

  async shutdown(): Promise<void> {
    this.startupComplete = false;
    this.state = "offline";
    this.broadcast({ type: "status", status: "offline" });
  }

  cancel(reservationId?: number, ownerId?: string): {
    ok: boolean;
    state?: string;
    finalizationReason?: string;
  } {
    if (reservationId == null || !ownerId) {
      return { ok: false };
    }
    if (!isAuthorizedOwnerId(ownerId)) {
      return { ok: false };
    }
    return this.core.cancelDelivery(ownerId, reservationId, (text) => {
      const session = this.loadState().activeSessionId;
      if (!session) return;
      this.logger.append({
        ts: new Date().toISOString(),
        role: "assistant",
        text,
        source: "nuclear",
        session_id: session,
        model: "partial",
      });
    });
  }

  startSession(): string {
    const id = randomBytes(8).toString("hex");
    this.saveState({ activeSessionId: id });
    return id;
  }

  finalizeDeliveryReservation(
    ownerId: string,
    reservationId: number,
    cause: "complete" | "cancel" | "send_failure" | "first_bubble_deadline" | "delivery_lease" = "complete",
    onArchivalAssistant?: (text: string) => void,
  ) {
    const result = this.core.finalizeDeliveryReservation(ownerId, reservationId, cause, onArchivalAssistant);
    const sidecar = this.openCognitiveSidecar();
    try {
      reconcileProjectedDelivery(sidecar, this.core.getDatabase(), reservationId);
    } catch (error) {
      console.error("[cognitive-v021] delivery reconciliation failed", error);
    }
    return result;
  }

}
