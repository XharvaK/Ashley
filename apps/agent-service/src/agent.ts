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
import { runLiveCognitiveTurn } from "./core/cognitive-v021/dispatch/live.js";
import { reconcileProjectedDelivery } from "./core/cognitive-v021/delivery/outbox-projector.js";
import { readCognitiveSidecarMeta } from "./core/cognitive-v021/sidecar/db.js";
import { appendInboxEvent, claimInboxEvent } from "./core/cognitive-v021/cycle/inbox.js";
import { consumeInboxEvent } from "./core/cognitive-v021/cycle/inbox-consumer.js";
import { DURABLE_WORK_COORDINATION_LEASE_MS } from "./core/cognitive-v021/retry/ledger.js";
import {
  tickIdleOpportunity,
  type IdleObservationDraft,
  type IdleThoughtRunner,
  type IdleTickResult,
} from "./core/cognitive-v021/initiative/idle.js";
import { tickAfterglow, type AfterglowTickResult } from "./core/cognitive-v021/initiative/afterglow.js";
import { tickAwake, type AwakeTickResult } from "./core/cognitive-v021/initiative/awake.js";
import { tickNight, type NightTickResult } from "./core/cognitive-v021/initiative/night.js";
import {bindAdmittedCause,attachSelectedObservations,type SelectedPassExecution} from "./core/cognitive-v021/thalamus/execution.js";
import {retainSubscriptionFacts} from "./core/cognitive-v021/thalamus/subscription-facts.js";
import {pollObservationSubscriptions} from "./core/cognitive-v021/observation/subscriptions.js";
import {getCurrentCycle} from "./core/cognitive-v021/cycle/inbox.js";
import {getActiveDeferredFrontier} from "./core/cognitive-v021/frontier/ledger.js";
import {isPrivateThoughtActive} from "./core/cognitive-v021/initiative/idle.js";
import {recordInfluencedCuriosityRank} from "./core/cognitive-v021/influences/curiosity.js";
import {PRIVATE_SUBSCRIPTION_ITEMS_PER_IDLE} from "./core/cognitive-v021/types.js";
import {collectInnerFacts} from "./core/cognitive-v021/thalamus/current-facts.js";
import {runThalamusPass} from "./core/cognitive-v021/thalamus/integration.js";
import {isThalamusEnabled} from "./core/cognitive-v021/thalamus/scheduler.js";
import {prospective} from "./core/cognitive-v021/thalamus/nuclei/prospective.js";
import {isCommitmentsEnabled,listDueCommitmentOpportunities,type CommitmentOpportunity} from "./core/relationship/commitment-admission.js";
import { DEFAULT_OWNER_TIME_ZONE } from "./core/cognitive-v021/thought/clock.js";
import { detectCredentialShape, CREDENTIAL_OMITTED_PLACEHOLDER } from "./core/privacy/secrets.js";
import { scanConfiguredSources } from "./core/curiosity/sources.js";
import { performGroundedReads, type ReadRecord } from "./core/curiosity/reads.js";
import { listRecentTakes } from "./core/curiosity/feed.js";
import {
  nuclearTakeToObservationDraft,
  readRecordToObservationDraft as readRecordToCuriosityObservationDraft,
} from "./core/cognitive-v021/perception/adapter.js";
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
  private shuttingDown = false;
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
  async tickCognitiveIdle(ownerId: string, selected?:SelectedPassExecution & {nowMs:number;selection:{triggerId?:string;commitmentId?:string};commitment?:CommitmentOpportunity}): Promise<IdleTickResult> {
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
      commitmentDb: nuclear,
      commitmentOwnerId: ownerId,
      ...(selected?{nowMs:selected.nowMs,thalamusSelection:selected.selection,commitment:selected.commitment}:{}),
      // Growth V1: the AWAKE rhythm (tickCognitiveAwake) replaced the 4 h
      // periodic schedule, and PERIODIC_COGNITION_ENABLED now switches AWAKE.
      periodicCognitionEnabled: false,
      curiosityObservationProvider: async () => {
        if(selected?.observations?.length)return [...selected.observations];
        try { await scanConfiguredSources(nuclear); } catch { /* mechanical acquisition must not block Thought */ }
        try {
          const result = await performGroundedReads(nuclear, ownerId);
          const reads = result.reads
            .map(readRecordToCuriosityObservationDraft)
            .filter((observation): observation is IdleObservationDraft => observation !== null);
          const takes = listRecentTakes(nuclear, 12)
            .map(nuclearTakeToObservationDraft)
            .filter((observation): observation is IdleObservationDraft => observation !== null);
          const seen = new Set<string>();
          return [...reads, ...takes].filter((observation) => {
            if (seen.has(observation.observationId)) return false;
            seen.add(observation.observationId);
            return true;
          });
        } catch {
          return [];
        }
      },
      runThought: this.privateThoughtRunner(sidecar, ownerId,selected?.bind,selected?.observations),
    });
  }

  async tickCognitiveThalamus(ownerId:string,nowMs=Date.now(),afterglowEnabled=true){
    if(!isThalamusEnabled())return {kind:"disabled"} as const;
    const sidecar=this.openCognitiveSidecar();
    if(!sidecar || !this.cognitiveDeps)throw new AppError("agent_not_ready","Cognitive dispatcher unavailable",503);
    const nuclear=this.core.getDatabase(),conversationId=resolveActiveThread(nuclear,ownerId,"discord");
    const current=collectInnerFacts(sidecar,{ownerId,conversationId,nowMs,timeZone:env.ownerTimeZone || DEFAULT_OWNER_TIME_ZONE,
      afterglowEnabled,dataDir:this.dataPlane?.dataDir});
    const canAcquire=current.context.budgetAvailable && !getCurrentCycle(sidecar,conversationId)
      && !isPrivateThoughtActive(conversationId) && !getActiveDeferredFrontier(sidecar,conversationId);
    const polled=canAcquire?await pollObservationSubscriptions(sidecar,{conversationId,nowMs}):{items:[]};
    const subscriptions=retainSubscriptionFacts(sidecar,{ownerId,conversationId,nowMs,items:polled.items});
    current.candidates.push(...subscriptions.candidates);current.facts.push(...subscriptions.facts);
    const commitments=isCommitmentsEnabled()?listDueCommitmentOpportunities(nuclear,ownerId,nowMs):[];
    current.candidates.push(...prospective(commitments.map(item=>({eventId:`commitment:${item.commitmentId}`,observedAtMs:item.fireAtMs ?? nowMs,
      refs:[item.commitmentId],kind:"commitment" as const,dueAtMs:item.fireAtMs ?? nowMs})),nowMs));
    return runThalamusPass(sidecar,{ownerId,conversationId,nowMs,enabled:true,...current,
      prepare:(decision,selected)=>({...selected,
        observations:decision.bundle.flatMap(candidate=>subscriptions.retained.get(candidate.eventId)?[subscriptions.retained.get(candidate.eventId)!]:[]).slice(0,PRIVATE_SUBSCRIPTION_ITEMS_PER_IDLE),
        bind:cycleId=>{selected.bind(cycleId);recordInfluencedCuriosityRank(sidecar,subscriptions.curiosity,{cycleId,ownerId},nowMs);},
      }),executors:{
      afterglow:selected=>this.tickCognitiveAfterglow(ownerId,nowMs,selected),
      night:selected=>this.tickCognitiveNight(ownerId,nowMs,afterglowEnabled,selected),
      awake:selected=>this.tickCognitiveAwake(ownerId,nowMs,afterglowEnabled,selected),
      idle:(selection,selected)=>this.tickCognitiveIdle(ownerId,{...selected,nowMs,selection,
        commitment:commitments.find(item=>item.commitmentId===selection.commitmentId)}),
    }});
  }

  /**
   * Growth V1 afterglow: reflect on the Owner conversation once it has gone
   * quiet (or grown long), through the same private Thought path.
   */
  async tickCognitiveAfterglow(ownerId: string, nowMs = Date.now(), selected?:SelectedPassExecution): Promise<AfterglowTickResult> {
    const sidecar = this.openCognitiveSidecar();
    if (!sidecar || !this.cognitiveDeps) {
      throw new AppError("agent_not_ready", "Cognitive dispatcher unavailable", 503);
    }
    const conversationId = resolveActiveThread(this.core.getDatabase(), ownerId, "discord");
    return tickAfterglow(sidecar, {
      conversationId,
      occupantId: ownerId,
      authorityEpoch: readCognitiveSidecarMeta(sidecar).authority_epoch,
      nowMs,
      timing:selected?.timing,
      thought: this.privateThoughtRunner(sidecar, ownerId,selected?.bind,selected?.observations),
    });
  }

  /**
   * Growth V1 AWAKE: Ashley's own time every three hours, through the same
   * private Thought path. Waits for a due afterglow and for a live conversation.
   */
  async tickCognitiveAwake(ownerId: string, nowMs = Date.now(), afterglowEnabled = true, selected?:SelectedPassExecution): Promise<AwakeTickResult> {
    const sidecar = this.openCognitiveSidecar();
    if (!sidecar || !this.cognitiveDeps) {
      throw new AppError("agent_not_ready", "Cognitive dispatcher unavailable", 503);
    }
    const conversationId = resolveActiveThread(this.core.getDatabase(), ownerId, "discord");
    return tickAwake(sidecar, {
      conversationId,
      occupantId: ownerId,
      authorityEpoch: readCognitiveSidecarMeta(sidecar).authority_epoch,
      nowMs,
      afterglowEnabled,
      timing:selected?.timing,
      thought: this.privateThoughtRunner(sidecar, ownerId,selected?.bind,selected?.observations),
    });
  }

  /**
   * Growth V1 NIGHT: once a day at the Owner's quietest hour, consolidation
   * and the diary; every seventh night also the "who I am becoming" narrative.
   */
  async tickCognitiveNight(ownerId: string, nowMs = Date.now(), afterglowEnabled = true, selected?:SelectedPassExecution): Promise<NightTickResult> {
    const sidecar = this.openCognitiveSidecar();
    if (!sidecar || !this.cognitiveDeps) {
      throw new AppError("agent_not_ready", "Cognitive dispatcher unavailable", 503);
    }
    const conversationId = resolveActiveThread(this.core.getDatabase(), ownerId, "discord");
    return tickNight(sidecar, {
      conversationId,
      occupantId: ownerId,
      authorityEpoch: readCognitiveSidecarMeta(sidecar).authority_epoch,
      timeZone: env.ownerTimeZone || DEFAULT_OWNER_TIME_ZONE,
      nowMs,
      afterglowEnabled,
      timing:selected?.timing,
      thought: this.privateThoughtRunner(sidecar, ownerId,selected?.bind,selected?.observations),
    });
  }

  /** Runs one admitted private Thought through the durable inbox and kernel. */
  private privateThoughtRunner(sidecar: DatabaseSync, ownerId: string, bind?:(cycleId:string)=>void,extra:readonly IdleObservationDraft[]=[]): IdleThoughtRunner {
    const runner:IdleThoughtRunner = async (original) => {
        const input=attachSelectedObservations(sidecar,original,extra);
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
            ...(input.commitmentId ? { commitmentId: input.commitmentId } : {}),
            ...(input.commitmentLatenessMs === undefined ? {} : { commitmentLatenessMs: input.commitmentLatenessMs }),
            ...(input.commitmentLateBehavior ? { commitmentLateBehavior: input.commitmentLateBehavior } : {}),
            ...(input.commitmentLatestUsefulAtMs === undefined ? {} : { commitmentLatestUsefulAtMs: input.commitmentLatestUsefulAtMs }),
            ...(input.commitmentRequiredPrecisionMs === undefined ? {} : { commitmentRequiredPrecisionMs: input.commitmentRequiredPrecisionMs }),
            ...(input.commitmentTimezoneId ? { commitmentTimezoneId: input.commitmentTimezoneId } : {}),
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
    };
    return bind ? bindAdmittedCause(runner,bind) : runner;
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
    return !this.shuttingDown && this.bootValidationSucceeded && this.startupComplete && this.activeConversationPathConfigured();
  }

  async init(): Promise<void> {
    this.shuttingDown = false;
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

  beginShutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.startupComplete = false;
    this.state = "offline";
    this.broadcast({ type: "status", status: "offline" });
  }

  async shutdown(): Promise<void> {
    this.beginShutdown();
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
