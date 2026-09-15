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
import { repairMissingC3Experiences } from "./core/cognitive-v021/failure/c3-recovery.js";
import { startFrontierCoordinator, type FrontierCoordinatorHandle } from "./core/cognitive-v021/frontier/index.js";
import {
  classifyInitiativeClass,
  evaluateProactiveEligibility,
} from "./core/cognitive-v021/initiative/eligibility.js";
import type { KernelDeps, Observation } from "./core/cognitive-v021/types.js";
import { createV021LiveOperationExecutors } from "./core/cognitive-v021/dispatch/live-operations.js";
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
  reconsiderPendingSpeechOutbox,
  reconsiderPendingSystemNotices,
} from "./core/cognitive-v021/sidecar/recovery.js";
import {
  admitExternalBatch,
  isExternalSocialCaptureEnabled,
} from "./core/cognitive-v021/ingress/http.js";
import { createLiveExpressionBinding } from "./core/cognitive-v021/speech/live-expression.js";

export function createAgentInboxConsumerHandler(
  manager: Pick<AgentManager, "dispatchCognitiveEvent">,
): InboxConsumerHandler {
  return (event) => manager.dispatchCognitiveEvent(event);
}

export async function serveAgent(manager: AgentManager): Promise<void> {
  await manager.init();
  const cognitiveSidecar = manager.openCognitiveSidecar();
  let cognitiveConsumer: InboxConsumerHandle | null = null;
  let frontierCoordinator: FrontierCoordinatorHandle | null = null;
  let derivedStore: DerivedStore | null = null;
  let observabilityDb: DatabaseSync | null = null;
  let projectSystemNotice: ((noticeId: number) => Promise<void>) | undefined;
  if (cognitiveSidecar) {
    const nuclear = manager.core.getDatabase();
    const ownerId = env.memoryOwnerId || env.discordOwnerId || "default";
    const capabilityReality = getCapabilityReality(nuclear);
    const liveOperationExecutors = createV021LiveOperationExecutors({
      nuclear,
      ownerId,
      sidecar: cognitiveSidecar,
    });
    const projector = createOutboxProjector(cognitiveSidecar, nuclear, {
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
    registerDerivedStoreForSidecar(cognitiveSidecar, derivedStore, nuclear);
    let derivedReady = false;
    try {
      reconcileDerivedInvalidationJournal(nuclear, cognitiveSidecar, derivedStore);
      derivedReady = derivedStore.reconcileAtStartup(cognitiveSidecar, { authorityDb: nuclear });
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
      checkAuthority,
    loadAuthorityPacks: () => loadAuthorityPacks(cognitiveSidecar, {
      capability: getCapabilityReality(nuclear),
      authorityDb: nuclear,
      receiptLimit: 256,
    }),
      projectOutbox: (outboxId) => projector.project(outboxId),
      projectSystemNotice: (noticeId) => projector.projectSystem(noticeId),
      constitution: readIdentitySlice(nuclear, ownerId),
      capabilityReality,
      derivedStore,
      observabilityDb,
    };
    manager.configureCognitiveDispatch({ deps, projector });
    reconcileStartupOwnership(cognitiveSidecar);
    if (isExternalSocialCaptureEnabled()) {
      const externalRecovery = await reconcileUnbatchedCaptures(cognitiveSidecar, {
        batch: (input) => admitExternalBatch(
          cognitiveSidecar,
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
    }
    const speechRecovery = await reconsiderPendingSpeechOutbox(
      cognitiveSidecar,
      (outboxId) => projector.project(outboxId),
    );
    if (speechRecovery.failures > 0) {
      console.warn(
        `[cognitive-v021] pending speech recovery deferred rows=${speechRecovery.failures}`,
      );
    }
    const noticeRecovery = await reconsiderPendingSystemNotices(
      cognitiveSidecar,
      (noticeId) => projector.projectSystem(noticeId),
      { lane: "social_notify" },
    );
    if (noticeRecovery.failures > 0) {
      console.warn(
        `[cognitive-v021] pending social notification recovery deferred rows=${noticeRecovery.failures}`,
      );
    }
    try {
      const deliveryRecovery = reconcileProjectedDeliverySweep(cognitiveSidecar, nuclear, { limit: 50 });
      if (deliveryRecovery.conflicts > 0) {
        console.warn(
          `[cognitive-v021] delivery reconciliation conflicts=${deliveryRecovery.conflicts}`,
        );
      }
    } catch (error) {
      console.warn("[cognitive-v021] delivery reconciliation startup sweep deferred", error);
    }
    // Durable-work outcome reconciliation owns stranded outcome-unknown work.
    // It runs after cycle ownership reconciliation and before the inbox
    // consumer begins, so Gen15-like reconciling work can become pending only
    // through proof-gated durable-work authority. cycle/reconcile never calls
    // reconcileOutcomeUnknown.
    reconcileStrandedOutcomeUnknownAtStartup(cognitiveSidecar, { nowMs: Date.now() });
    try {
      await repairMissingC3Experiences(cognitiveSidecar, nuclear, { nowMs: Date.now(), limit: 50 });
    } catch (error) {
      console.warn("[cognitive-v021] c3_recovery_deferred_for_forward_repair", error);
    }
    cognitiveConsumer = startInboxConsumer(cognitiveSidecar, {
      workerId: `agent-service:${process.pid}`,
      handler: createAgentInboxConsumerHandler(manager),
      onReconciliationMaintenance: (nowMs) => {
        try {
          const deliveryRecovery = reconcileProjectedDeliverySweep(cognitiveSidecar, nuclear, { limit: 50 });
          if (deliveryRecovery.conflicts > 0) {
            console.warn(
              `[cognitive-v021] delivery reconciliation conflicts=${deliveryRecovery.conflicts}`,
            );
          }
        } catch (error) {
          console.warn("[cognitive-v021] delivery reconciliation maintenance deferred", error);
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
      cognitiveSidecar,
      nuclear,
      deps,
      {
        workerId: `agent-service:${process.pid}`,
        projector,
      },
    );
  }
  const app = createServer(manager, {
    cognitiveSidecar,
    observabilityDb,
    projectSystemNotice,
  });
  const server = listen(app);
  manager.markStartupComplete();
  console.log(
    `[agent-service] nuclear core enabled db=${manager.core.getHealth().dbPath} plane=${manager.dataPlane.kind}`,
  );

  const shutdown = async (signal: string) => {
    console.log(`[agent-service] ${signal}`);
    cognitiveConsumer?.stop();
    frontierCoordinator?.stop();
    if (cognitiveConsumer) await cognitiveConsumer.done;
    derivedStore?.close();
    try { observabilityDb?.close(); } catch { /* ignore */ }
    await manager.shutdown();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
