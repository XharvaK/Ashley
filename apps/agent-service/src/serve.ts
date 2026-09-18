import type { AgentManager } from "./agent.js";
import { env } from "./env.js";
import { createServer, listen } from "./server.js";
import { completeChat } from "./mistral-client.js";
import { checkAuthority } from "./core/cognitive-v021/authority/check.js";
import { loadAuthorityPacks } from "./core/cognitive-v021/authority/packs.js";
import { getCapabilityReality } from "./core/cognitive-v021/thought/capability-reality.js";
import { readIdentitySlice } from "./core/cognitive-v021/identity/constitution.js";
import { runPerceptionBeforeThought } from "./core/cognitive-v021/perception/adapter.js";
import { sweepExpiredArtifacts } from "./core/perception/artifact-store.js";
import { createOutboxProjector, reconcileProjectedDeliverySweep } from "./core/cognitive-v021/delivery/outbox-projector.js";
import { startInboxConsumer, type InboxConsumerHandle, type InboxConsumerHandler } from "./core/cognitive-v021/cycle/inbox-consumer.js";
import {
  reconcileStartupOwnership,
  reconcileUnbatchedCaptures,
} from "./core/cognitive-v021/cycle/reconcile.js";
import { reconcileStrandedOutcomeUnknownAtStartup } from "./core/cognitive-v021/retry/startup-outcome-recovery.js";
import { serviceUnansweredOwnerRecovery } from "./core/cognitive-v021/retry/owner-recovery.js";
import { repairMissingC3Experiences } from "./core/cognitive-v021/failure/c3-recovery.js";
import { startFrontierCoordinator, type FrontierCoordinatorHandle } from "./core/cognitive-v021/frontier/index.js";
import {
  classifyInitiativeClass,
  evaluateProactiveEligibility,
} from "./core/cognitive-v021/initiative/eligibility.js";
import type { KernelDeps, Observation } from "./core/cognitive-v021/types.js";
import { createV021LiveOperationExecutors } from "./core/cognitive-v021/dispatch/live-operations.js";
import {
  detachInvestigateIntent,
  dispatchDetachedOperation,
} from "./core/cognitive-v021/operation/dispatch.js";
import { reconcileMissingCompletions } from "./core/cognitive-v021/operation/completion.js";
import {
  openDerivedStore,
  defaultDerivedIndexDbPath,
  registerDerivedStoreForSidecar,
  type DerivedStore,
} from "./core/cognitive-v021/retrieval/derived-store.js";
import { reconcileDerivedInvalidationJournal } from "./core/cognitive-v021/retrieval/derived-retraction.js";
import {
  defaultObservabilityDbPath,
  initObservabilitySchema,
  purgeThoughtDebugCaptures,
} from "./core/cognitive-v021/thought/diagnostics.js";
import { DatabaseSync } from "node:sqlite";
import { reconcileAuthorityBarrierOnStartup } from "./core/cognitive-v021/authority/barrier.js";
import {
  reconsiderPendingInterim,
  reconsiderPendingSpeechOutbox,
  reconsiderPendingSystemNotices,
} from "./core/cognitive-v021/sidecar/recovery.js";
import {
  admitExternalBatch,
  isExternalSocialCaptureEnabled,
} from "./core/cognitive-v021/ingress/http.js";
import { promoteEligiblePending } from "./core/cognitive-v021/social/dm-activation.js";
import { promoteEligibleRoomPending } from "./core/cognitive-v021/social/room-activation.js";
import { recoverInitialContactEligibility } from "./core/cognitive-v021/social/continuity-memory.js";
import { createLiveExpressionBinding } from "./core/cognitive-v021/speech/live-expression.js";
import {
  isCommitmentsEnabled,
  recoverCommitmentOpportunities,
  recoverPendingCommitmentProposals,
} from "./core/relationship/commitment-admission.js";
import { seedTrustedRoomsFromOwnerEnvironment } from "./core/relationship/room-seeding.js";

export function createAgentInboxConsumerHandler(
  manager: Pick<AgentManager, "dispatchCognitiveEvent">,
): InboxConsumerHandler {
  return (event) => manager.dispatchCognitiveEvent(event);
}

type StartupCleanupResources = {
  cognitiveSidecar: DatabaseSync | null;
  cognitiveConsumer: InboxConsumerHandle | null;
  frontierCoordinator: FrontierCoordinatorHandle | null;
  derivedStore: DerivedStore | null;
  observabilityDb: DatabaseSync | null;
};

export async function closeStartupResources(
  manager: Pick<AgentManager, "shutdown" | "logger" | "core">,
  resources: StartupCleanupResources,
): Promise<void> {
  resources.cognitiveConsumer?.stop();
  resources.frontierCoordinator?.stop();
  try {
    if (resources.cognitiveConsumer) await resources.cognitiveConsumer.done;
  } catch {
    // Preserve the primary startup failure.
  }
  try {
    await manager.shutdown();
  } catch {
    // Preserve the primary startup failure.
  }
  try {
    resources.derivedStore?.close();
  } catch {
    // Preserve the primary startup failure.
  }
  try {
    resources.observabilityDb?.close();
  } catch {
    // Preserve the primary startup failure.
  }
  try {
    resources.cognitiveSidecar?.close();
  } catch {
    // Preserve the primary startup failure.
  }
  try {
    manager.logger.close();
  } catch {
    // Preserve the primary startup failure.
  }
  try {
    manager.core.getDatabase().close();
  } catch {
    // Preserve the primary startup failure.
  }
}

type ShutdownResources = Pick<
  StartupCleanupResources,
  "cognitiveConsumer" | "frontierCoordinator" | "derivedStore" | "observabilityDb"
>;

type ShutdownServer = {
  close: (callback: (error?: Error) => void) => void;
};

export async function shutdownAgent(
  manager: Pick<AgentManager, "beginShutdown" | "shutdown" | "core">,
  resources: ShutdownResources,
  server: ShutdownServer,
  signal: string,
  exit: (code: number) => void = (code) => process.exit(code),
): Promise<void> {
  console.log(`[agent-service] ${signal}`);
  try {
    manager.beginShutdown();
    resources.cognitiveConsumer?.stop();
    if (resources.cognitiveConsumer) await resources.cognitiveConsumer.done;
    resources.frontierCoordinator?.stop();
    resources.derivedStore?.close();
    resources.observabilityDb?.close();
    await manager.shutdown();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    manager.core.shutdownContinuityClean();
  } catch (error) {
    console.error(`[agent-service] ${signal} shutdown failed`, error);
    exit(1);
    return;
  }
  exit(0);
}

export async function serveAgent(manager: AgentManager): Promise<void> {
  let cognitiveSidecar: DatabaseSync | null = null;
  let cognitiveConsumer: InboxConsumerHandle | null = null;
  let frontierCoordinator: FrontierCoordinatorHandle | null = null;
  let derivedStore: DerivedStore | null = null;
  let observabilityDb: DatabaseSync | null = null;
  let projectSystemNotice: ((noticeId: number) => Promise<void>) | undefined;
  try {
    await manager.init();
    if (manager.getState() !== "booting") {
      throw new Error("agent_not_ready");
    }
    cognitiveSidecar = manager.openCognitiveSidecar();
  if (cognitiveSidecar) {
    const sidecar = cognitiveSidecar;
    const nuclear = manager.core.getDatabase();
    const ownerId = env.memoryOwnerId || env.discordOwnerId || "default";
    seedTrustedRoomsFromOwnerEnvironment(nuclear, { ownerId });
    const capabilityReality = getCapabilityReality(nuclear);
    const liveOperationExecutors = createV021LiveOperationExecutors({
      nuclear,
      ownerId,
      sidecar,
    });
    const projector = createOutboxProjector(sidecar, nuclear, {
      gate: (deliveryIntent) => {
        if (deliveryIntent.deliveryLane !== "proactive") return { ok: true };
        const status = manager.core.getProactiveOperationalStatus(deliveryIntent.ownerId);
        const eligibility = evaluateProactiveEligibility(nuclear, {
          ownerId: deliveryIntent.ownerId,
          chatInProgress: !manager.core.isExpressionQuiesced(deliveryIntent.ownerId),
          paused: status.paused,
          enabled: status.enabled,
          sentToday: status.sentToday,
          maxPerDay: status.maxPerDay,
          lastUserMessageAt: status.lastUserMessageAt,
          minIdleHours: status.minIdleHours,
          hasUrgent: classifyInitiativeClass(nuclear, deliveryIntent.ownerId) === "urgent_grounded",
        });
        return eligibility.ok ? { ok: true } : { ok: false, reason: eligibility.reason };
      },
    });
    projectSystemNotice = (noticeId) => projector.projectSystem(noticeId);
    derivedStore = openDerivedStore(defaultDerivedIndexDbPath());
    observabilityDb = new DatabaseSync(defaultObservabilityDbPath());
    initObservabilitySchema(observabilityDb);
    try {
      purgeThoughtDebugCaptures(observabilityDb, Date.now());
    } catch (error) {
      console.warn("[cognitive-v021] thought_debug_startup_purge_deferred", error);
    }
    registerDerivedStoreForSidecar(sidecar, derivedStore, nuclear);
    let derivedReady = false;
    try {
      reconcileDerivedInvalidationJournal(nuclear, sidecar, derivedStore);
      derivedReady = derivedStore.reconcileAtStartup(sidecar, { authorityDb: nuclear });
    } catch {
      derivedStore.markInvalid();
    }
    reconcileAuthorityBarrierOnStartup(nuclear, { projectionReady: derivedReady });

    const deps: KernelDeps = {
      nowMs: () => Date.now(),
      attentionDb: nuclear,
      completeChat,
      ...createLiveExpressionBinding({
        attentionDb: nuclear,
        completeChat,
      }),
      runPerception: async (input): Promise<Observation[]> => runPerceptionBeforeThought({
        ...input,
        runPerception: async () => [],
      }),
      executeObservation: liveOperationExecutors.executeObservation,
      executeEffect: liveOperationExecutors.executeEffect,
      checkAuthority: (stage, input) => checkAuthority(stage, {
        ...input,
        receiptDb: sidecar,
      }),
      loadAuthorityPacks: () => loadAuthorityPacks(sidecar, {
        capability: getCapabilityReality(nuclear),
        authorityDb: nuclear,
        receiptLimit: 256,
      }),
      projectOutbox: (outboxId) => projector.project(outboxId),
      projectSystemNotice: (noticeId) => projector.projectSystem(noticeId),
      projectInterim: (interimId) => projector.projectInterim(interimId),
      detachInvestigate: (input) => liveOperationExecutors.canOfferDetachedInvestigate()
        ? detachInvestigateIntent(sidecar, input)
        : { detached: false as const, reason: "detach_unavailable" },
      dispatchDetached: (operationId) => {
        void dispatchDetachedOperation(sidecar, operationId, async (workerInput) => {
          const result = await liveOperationExecutors.runDetachedInvestigate({
            request: workerInput.request,
            cycleId: workerInput.operation.originCycleId,
            purpose: workerInput.purpose,
          });
          if (result.license.state === "succeeded") {
            return { ok: true, payload: result.payload };
          }
          return {
            ok: false,
            errorCode: typeof result.license.error === "string" && result.license.error.length > 0
              ? result.license.error
              : `worker_${result.license.state}`,
          };
        }).catch(() => {
          // dispatchDetachedOperation is total and persists terminal truth
          // itself; this guards only against unexpected trigger bugs.
        });
      },
      constitution: readIdentitySlice(nuclear, ownerId),
      capabilityReality,
      derivedStore,
      observabilityDb,
    };
    manager.configureCognitiveDispatch({ deps, projector });
    reconcileStartupOwnership(sidecar);
    if (isExternalSocialCaptureEnabled()) {
      const externalRecovery = await reconcileUnbatchedCaptures(sidecar, {
        batch: (input) => admitExternalBatch(
          sidecar,
          nuclear,
          input,
          { ownerId, projectSystemNotice },
        ),
      });
      if (externalRecovery.failures > 0) {
        console.warn(
          `[cognitive-v021] unbatched external capture recovery deferred rows=${externalRecovery.failures}`,
        );
      }
      const initialContactRecovery = recoverInitialContactEligibility(sidecar, nuclear);
      if (initialContactRecovery.failures > 0) {
        console.warn(
          `[cognitive-v021] initial external contact recovery deferred rows=${initialContactRecovery.failures}`,
        );
      }
    }
    if (isCommitmentsEnabled()) {
      try {
        recoverPendingCommitmentProposals(nuclear, { ownerId, nowMs: Date.now(), enabled: true });
        recoverCommitmentOpportunities(nuclear, { ownerId, nowMs: Date.now() });
      } catch (error) {
        console.warn("[cognitive-v021] commitment recovery deferred", error);
      }
    }
    const dmPromotion = promoteEligiblePending(sidecar, nuclear, { ownerId });
    if (dmPromotion.rejected > 0) {
      console.warn(
        `[cognitive-v021] external DM promotion deferred rows=${dmPromotion.rejected}`,
      );
    }
    const roomPromotion = promoteEligibleRoomPending(sidecar, nuclear, { ownerId });
    if (roomPromotion.rejected > 0) {
      console.warn(
        `[cognitive-v021] external room promotion deferred rows=${roomPromotion.rejected}`,
      );
    }
    const speechRecovery = await reconsiderPendingSpeechOutbox(
      sidecar,
      (outboxId) => projector.project(outboxId),
    );
    if (speechRecovery.failures > 0) {
      console.warn(
        `[cognitive-v021] pending speech recovery deferred rows=${speechRecovery.failures}`,
      );
    }
    const noticeRecovery = await reconsiderPendingSystemNotices(
      sidecar,
      (noticeId) => projector.projectSystem(noticeId),
    );
    if (noticeRecovery.failures > 0) {
      console.warn(
        `[cognitive-v021] pending system notice recovery deferred rows=${noticeRecovery.failures}`,
      );
    }
    const interimRecovery = await reconsiderPendingInterim(
      sidecar,
      (interimId) => projector.projectInterim(interimId),
    );
    if (interimRecovery.failures > 0) {
      console.warn(
        `[cognitive-v021] pending interim recovery deferred rows=${interimRecovery.failures}`,
      );
    }
    const deliveryRecovery = reconcileProjectedDeliverySweep(sidecar, nuclear, { limit: 50 });
    if (deliveryRecovery.conflicts > 0) {
      console.warn(
        `[cognitive-v021] delivery reconciliation conflicts=${deliveryRecovery.conflicts}`,
      );
    }
    // Durable-work outcome reconciliation owns stranded outcome-unknown work.
    // It runs after cycle ownership reconciliation and before the inbox
    // consumer begins, so Gen15-like reconciling work can become pending only
    // through proof-gated durable-work authority. cycle/reconcile never calls
    // reconcileOutcomeUnknown.
    reconcileStrandedOutcomeUnknownAtStartup(sidecar, { nowMs: Date.now() });
    // R1 unanswered-Owner recovery: discover terminal/quarantined Owner
    // obligations with no ordinary continuation and materialize at most one
    // conversation-coalesced repair undertaking per conversation, then
    // converge mechanically orphaned pending wakes. Runs after ownership and
    // outcome-unknown reconciliation so eligibility sees settled truth, and
    // before the inbox consumer begins so repairs enter ordinary claim flow.
    try {
      const ownerRecovery = serviceUnansweredOwnerRecovery(sidecar, { nowMs: Date.now() });
      if (ownerRecovery.createdRepairs.length > 0
        || ownerRecovery.wakesConverged.length > 0
        || ownerRecovery.failedConversations.length > 0
        || ownerRecovery.lineageExhaustedConversations.length > 0) {
        console.warn(
          `[cognitive-v021] unanswered owner recovery eligible=${ownerRecovery.eligibleConversations} repairs=${ownerRecovery.createdRepairs.length} wakes_converged=${ownerRecovery.wakesConverged.length} failed=${ownerRecovery.failedConversations.length} lineage_exhausted=${ownerRecovery.lineageExhaustedConversations.length}`,
        );
      }
    } catch (error) {
      console.warn("[cognitive-v021] unanswered_owner_recovery_deferred", error);
    }
    try {
      await repairMissingC3Experiences(sidecar, nuclear, { nowMs: Date.now(), limit: 50 });
    } catch (error) {
      console.warn("[cognitive-v021] c3_recovery_deferred_for_forward_repair", error);
    }
    // Detached-operation completion backfill: terminal truth already stands;
    // this fills completion opportunities lost between terminal commit and
    // completion production (crash boundary), before the consumer begins.
    try {
      const completions = reconcileMissingCompletions(sidecar, { nowMs: Date.now(), limit: 50 });
      if (completions.failures.length > 0) {
        console.warn(
          `[cognitive-v021] detached completion backfill deferred rows=${completions.failures.length}`,
        );
      }
    } catch (error) {
      console.warn("[cognitive-v021] detached_completion_backfill_deferred", error);
    }
    cognitiveConsumer = startInboxConsumer(sidecar, {
      workerId: `agent-service:${process.pid}`,
      handler: createAgentInboxConsumerHandler(manager),
      onReconciliationMaintenance: (nowMs) => {
        if (isExternalSocialCaptureEnabled()) {
          void reconcileUnbatchedCaptures(sidecar, {
            nowMs,
            batch: (input) => admitExternalBatch(
              sidecar,
              nuclear,
              input,
              { ownerId, projectSystemNotice },
            ),
          }).then((externalRecovery) => {
            if (externalRecovery.failures > 0) {
              console.warn(
                `[cognitive-v021] unbatched external capture maintenance deferred rows=${externalRecovery.failures}`,
              );
            }
          }).catch((error) => {
            console.warn("[cognitive-v021] external capture maintenance deferred", error);
          });
          try {
            const initialContactRecovery = recoverInitialContactEligibility(sidecar, nuclear, { nowMs });
            if (initialContactRecovery.failures > 0) {
              console.warn(
                `[cognitive-v021] initial external contact maintenance deferred rows=${initialContactRecovery.failures}`,
              );
            }
          } catch (error) {
            console.warn("[cognitive-v021] initial external contact maintenance deferred", error);
          }
        }
        if (isCommitmentsEnabled()) {
          try {
            recoverPendingCommitmentProposals(nuclear, { ownerId, nowMs, enabled: true });
            recoverCommitmentOpportunities(nuclear, { ownerId, nowMs });
          } catch (error) {
            console.warn("[cognitive-v021] commitment maintenance deferred", error);
          }
        }
        try {
          const deliveryRecovery = reconcileProjectedDeliverySweep(sidecar, nuclear, { limit: 50 });
          if (deliveryRecovery.conflicts > 0) {
            console.warn(
              `[cognitive-v021] delivery reconciliation conflicts=${deliveryRecovery.conflicts}`,
            );
          }
        } catch (error) {
          console.warn("[cognitive-v021] delivery reconciliation maintenance deferred", error);
        }
        // R1 steady-state opportunity: newly terminalized eligible obligations
        // materialize a repair here; the pass is bounded and idempotent.
        try {
          serviceUnansweredOwnerRecovery(sidecar, { nowMs });
        } catch (error) {
          console.warn("[cognitive-v021] unanswered owner recovery maintenance deferred", error);
        }
        try {
          sweepExpiredArtifacts(nuclear, { nowMs, limit: 50 });
        } catch (error) {
          console.warn("[perception] artifact retention maintenance deferred", error);
        }
        if (observabilityDb) purgeThoughtDebugCaptures(observabilityDb, nowMs);
      },
      onError: (error, event) => console.error(`[cognitive-v021] event failed id=${event?.id ?? "?"}`, error),
    });
    frontierCoordinator = startFrontierCoordinator(
      sidecar,
      nuclear,
      deps,
      {
        workerId: `agent-service:${process.pid}`,
        projector,
      },
    );
  }
  let server: ReturnType<typeof listen>;
    const app = createServer(manager, {
      cognitiveSidecar,
      observabilityDb,
      projectSystemNotice,
    });
    server = listen(app);
  manager.markStartupComplete();
  console.log(
    `[agent-service] nuclear core enabled db=${manager.core.getHealth().dbPath} plane=${manager.dataPlane.kind}`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await shutdownAgent(
      manager,
      { cognitiveConsumer, frontierCoordinator, derivedStore, observabilityDb },
      server,
      signal,
    );
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  } catch (error) {
    await closeStartupResources(manager, {
      cognitiveSidecar,
      cognitiveConsumer,
      frontierCoordinator,
      derivedStore,
      observabilityDb,
    });
    throw error;
  }
}
