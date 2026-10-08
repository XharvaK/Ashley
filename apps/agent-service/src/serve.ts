import { placesHeld } from "./core/places/intents.js";
import { composeDuePlaceWishes, thoughtPlaceComposer } from "./core/places/compose.js";
import { homeRootFor } from "./core/home/home.js";
import { vaultDirFor } from "./core/reach/vault-dir.js";
import { createSelfChangeResultMaintenance, type SelfChangeResultMaintenance } from "./core/cognitive-v021/growth/self-change-results.js";
import { configureEmbodimentBudget } from "./core/domus/notification.js";
import { configurePrivateThoughtBudget } from "./core/cognitive-v021/private-budget/policies.js";
import { execFileSync } from "node:child_process";
import { loadWatchTerms, notifyWatch, scanWordWatch } from "./core/oversight/word-watch.js";
import { createDomusIngressApp, decideDomusIngress } from "./core/domus/ingress.js";
import { domusSnapshotDirFor } from "./core/domus/snapshots.js";
import type { AgentManager } from "./agent.js";
import { AFTERGLOW_POLL_MS } from "./core/cognitive-v021/initiative/afterglow.js";
import {isThalamusEnabled} from "./core/cognitive-v021/thalamus/scheduler.js";
import {THALAMUS_PARAMETERS} from "./core/cognitive-v021/thalamus/parameters.js";
import { isPeriodicCognitionEnabled } from "./core/cognitive-v021/dispatch/live.js";
import { env, nuclearIdentityOwnerId } from "./env.js";
import { createServer, listen } from "./server.js";
import { completeChat } from "./mistral-client.js";
import { checkAuthority } from "./core/cognitive-v021/authority/check.js";
import { loadAuthorityPacks } from "./core/cognitive-v021/authority/packs.js";
import { getCapabilityReality } from "./core/cognitive-v021/thought/capability-reality.js";
import { readIdentitySlice } from "./core/cognitive-v021/identity/constitution.js";
import { recoverSettlementAftermath } from "./core/cognitive-v021/thought/aftermath.js";
import { takePersonaSnapshotIfDue } from "./core/cognitive-v021/growth/snapshots.js";
import { loadLocalEmbedder, refreshMemoryVectors, type Embedder } from "./core/cognitive-v021/retrieval/vectors.js";
import { DEFAULT_OWNER_TIME_ZONE } from "./core/cognitive-v021/thought/clock.js";
import { runPerceptionBeforeThought } from "./core/cognitive-v021/perception/adapter.js";
import { createCommandCodeDirectVisionTransport } from "./core/cognitive-v021/perception/command-code-vision.js";
import { sweepExpiredArtifacts } from "./core/perception/artifact-store.js";
import { CuriosityWebFetchProvider } from "./core/perception/web-fetch-provider.js";
import { TavilyWebSearchProvider } from "./core/perception/tavily-search-provider.js";
import { createOutboxProjector, reconcileProjectedDeliverySweep } from "./core/cognitive-v021/delivery/outbox-projector.js";
import { reconcileOrphanedSendingDeliveries, reconcileUnfulfilledFailedSpeechReservations } from "./core/cognitive-v021/delivery/pending.js";
import { startInboxConsumer, type InboxConsumerHandle, type InboxConsumerHandler } from "./core/cognitive-v021/cycle/inbox-consumer.js";
import { DOMUS_LANE_PREFIX, domusLaneId } from "./core/domus/lane.js";
import {
  reconcileStartupOwnership,
  reconcileUnbatchedCaptures,
} from "./core/cognitive-v021/cycle/reconcile.js";
import { reconcileStrandedOutcomeUnknownAtStartup } from "./core/cognitive-v021/retry/startup-outcome-recovery.js";
import { serviceUnansweredOwnerRecovery } from "./core/cognitive-v021/retry/owner-recovery.js";
import { repairMissingC3Experiences } from "./core/cognitive-v021/failure/c3-recovery.js";
import { startFrontierCoordinator, type FrontierCoordinatorHandle } from "./core/cognitive-v021/frontier/index.js";
import { evaluateReachOutGate } from "./core/cognitive-v021/initiative/reach-out-gate.js";
import type { KernelDeps, Observation } from "./core/cognitive-v021/types.js";
import { createV021LiveOperationExecutors } from "./core/cognitive-v021/dispatch/live-operations.js";
import {
  dispatchDetachedOperation,
  enqueueWorkerUndertakingIntent,
  serviceWorkerUndertakings,
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
import {
  getCommitmentOpportunity,
  isCommitmentsEnabled,
  recoverCommitmentOpportunities,
  recoverPendingCommitmentProposals,
} from "./core/relationship/commitment-admission.js";
import { seedTrustedRoomsFromOwnerEnvironment } from "./core/relationship/room-seeding.js";
import type {
  CapabilityActivationReadiness,
  CapabilityName,
} from "./core/rollout/capabilities.js";
import {
  canOfferBoundedOperation,
  canOfferCandidateAuthorship,
  canOfferCandidateVerification,
  canOfferCandidateWorkspace,
  canOfferPatchExport,
  canOfferProjectInspection,
  loadOperatorProjectReadRegistry,
} from "./core/sandbox/project-registry.js";
import { isSandboxV2Available } from "./core/sandbox/v2-execution.js";
import {
  maintainCommandCode,
  writeCommandCodeQualificationState,
} from "./core/command-code/lifecycle.js";
import { qualifyCommandCodeCandidate } from "./core/command-code/production-qualification.js";
import { dirname, join } from "node:path";
import {
  ownerBootstrapReadinessFor,
  type OwnerBootstrapAvailability,
} from "./core/rollout/owner-bootstrap-readiness.js";

let lastSelfChangeResultMaintenanceCode: string | null = null;

function selfChangeResultMaintenanceCode(error: unknown): string {
  const coded = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  const text = typeof coded === "string" && coded.length > 0
    ? coded
    : error instanceof Error ? error.message : String(error);
  return text.slice(0, 80);
}

export function createAgentInboxConsumerHandler(
  manager: Pick<AgentManager, "dispatchCognitiveEvent">,
): InboxConsumerHandler {
  return (event) => manager.dispatchCognitiveEvent(event);
}

type StartupCleanupResources = {
  selfChangeResultMaintenance?: SelfChangeResultMaintenance | null;
  domusServer?: ShutdownServer | null;
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
  const resultProducerClose = resources.selfChangeResultMaintenance?.close();
  resources.cognitiveConsumer?.stop();
  resources.frontierCoordinator?.stop();
  await closeHttpServer(resources.domusServer);
  if (resultProducerClose) try { await resultProducerClose; } catch { /* preserve startup failure */ }
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
  "cognitiveConsumer" | "frontierCoordinator" | "derivedStore" | "observabilityDb" | "selfChangeResultMaintenance" | "domusServer"
>;

async function closeHttpServer(server: ShutdownServer | null | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

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
    const resultProducerClose = resources.selfChangeResultMaintenance?.close();
    resources.cognitiveConsumer?.stop();
    if (resultProducerClose) await resultProducerClose;
    if (resources.cognitiveConsumer) await resources.cognitiveConsumer.done;
    resources.frontierCoordinator?.stop();
    resources.derivedStore?.close();
    resources.observabilityDb?.close();
    await manager.shutdown();
    await closeHttpServer(resources.domusServer);
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
  let selfChangeResultMaintenance: SelfChangeResultMaintenance | null = null;
  let frontierCoordinator: FrontierCoordinatorHandle | null = null;
  let derivedStore: DerivedStore | null = null;
  // A5: the local embedder loads once, on first use; null when disabled or unavailable.
  let embedderPromise: Promise<Embedder | null> | null = null;
  let vectorRefreshRunning = false;
  const localEmbedder = (): Promise<Embedder | null> => {
    if (!env.localEmbeddingsEnabled || !env.localEmbeddingModel) return Promise.resolve(null);
    embedderPromise ??= loadLocalEmbedder({
      model: env.localEmbeddingModel,
      cacheDir: join(dirname(defaultDerivedIndexDbPath()), "models"),
    }).catch((error) => {
      console.warn("[cognitive-v021] local embedder unavailable", error instanceof Error ? error.message : "unknown");
      return null;
    });
    return embedderPromise;
  };
  let observabilityDb: DatabaseSync | null = null;
  let wordWatchAtMs = 0;
  let domusServer: ShutdownServer | null = null;
  // 8f latency: a newly admitted Domus observation asks for a thalamus pass now, not at the next minute.
  let onDomusArrival = (): void => {};
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
    const ownerId = nuclearIdentityOwnerId();
    seedTrustedRoomsFromOwnerEnvironment(nuclear, { ownerId });
    const webFetchProvider = env.curiosityEnabled
      ? new CuriosityWebFetchProvider()
      : undefined;
    const webSearchProvider = env.curiosityEnabled && env.curiosityLookupEnabled
      ? new TavilyWebSearchProvider(nuclear)
      : undefined;
    const visionTransport = env.commandCodeApiKey
      ? createCommandCodeDirectVisionTransport()
      : undefined;
    const projectRegistry = loadOperatorProjectReadRegistry();
    const sandboxGateOptions = {
      registry: projectRegistry,
      masterMode: env.cognitionMode,
      substrateAvailable: isSandboxV2Available(),
      lifecycleEnabled: env.sandboxEngineeringLifecycleEnabled,
    };
    const qualificationProjectId = projectRegistry
      .list()
      .find((entry) => entry.enabled === true && entry.readAllowed === true)
      ?.projectId;
    const runCommandCodeMaintenance = async (): Promise<void> => {
      if (!env.commandCodeUpdateEnabled) return;
      try {
        const result = await maintainCommandCode({
          baseDir: dirname(env.commandCodeRuntimeRoot),
          activeRootPath: env.commandCodeRuntimeRoot,
          qualificationStatePath: env.commandCodeQualificationStatePath,
          lifecycleStatePath: join(dirname(env.commandCodeQualificationStatePath), "command-code-lifecycle-state.json"),
          minimumVersion: env.commandCodeMinimumVersion,
          enabled: env.commandCodeUpdateEnabled,
          apiKeyPresent: env.commandCodeApiKey.trim().length > 0,
          qualifyCandidate: async (candidate) => {
            if (!qualificationProjectId) return { ok: false, reason: "no_approved_project_for_worker_qualification" };
            const qualification = await qualifyCommandCodeCandidate({
              candidate,
              apiKey: env.commandCodeApiKey,
              bubblewrapPath: env.commandCodeBubblewrapPath,
              minimumVersion: env.commandCodeMinimumVersion,
              registry: projectRegistry,
              nuclear,
              sidecar,
              ownerId,
              masterMode: env.cognitionMode,
              lifecycleEnabled: env.sandboxEngineeringLifecycleEnabled,
              substrateAvailable: isSandboxV2Available(),
              projectId: qualificationProjectId,
            });
            if (qualification.ok) {
              writeCommandCodeQualificationState(env.commandCodeQualificationStatePath, candidate.version);
            }
            return qualification;
          },
        });
        console.log(JSON.stringify({
          component: "command-code-lifecycle",
          status: result.status,
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          ...(result.reason ? { reason: result.reason } : {}),
        }));
      } catch (error) {
        console.warn("[command-code-lifecycle] maintenance_failed", error instanceof Error ? error.message : "unknown");
      }
    };
    await runCommandCodeMaintenance();
    const commandCodeMaintenanceTimer = env.commandCodeUpdateEnabled
      ? setInterval(() => void runCommandCodeMaintenance(), env.commandCodeUpdateIntervalHours * 60 * 60 * 1000)
      : null;
    commandCodeMaintenanceTimer?.unref();
    const ownerBootstrapAvailability: OwnerBootstrapAvailability = {
      commandCode: env.commandCodeApiKey.trim().length > 0,
      webFetch: webFetchProvider?.available === true,
      webSearch: webSearchProvider?.available === true,
      projectInspection: canOfferProjectInspection(undefined, sandboxGateOptions),
      projectExperimentation: canOfferCandidateWorkspace(undefined, sandboxGateOptions),
      candidateVerification: canOfferCandidateVerification(undefined, sandboxGateOptions),
      candidateAuthorship: canOfferCandidateAuthorship(undefined, sandboxGateOptions),
      boundedOperation: canOfferBoundedOperation(undefined, sandboxGateOptions),
      patchExport: canOfferPatchExport(undefined, sandboxGateOptions),
      ownerGrantedCapabilities: new Set<CapabilityName>([
        "external_observe",
        "external_prepare",
        "external_private",
        "external_public",
        "memory_evidence",
        "context_budget",
        "learned_autonomy",
        "cognitive_graduation",
        "relational_graduation",
      ]),
    };
    manager.core.configureCapabilityActivationReadiness((capability: CapabilityName): CapabilityActivationReadiness => {
      return ownerBootstrapReadinessFor(capability, ownerBootstrapAvailability);
    });
    const capabilityReality = getCapabilityReality(nuclear, {
      webFetchProvider,
      webSearchProvider,
      visionTransport,
    });
    const liveOperationExecutors = createV021LiveOperationExecutors({
      nuclear,
      ownerId,
      sidecar,
      ...(manager.dataPlane?.dataDir ? { homeRoot: homeRootFor(manager.dataPlane.dataDir), vaultDir: vaultDirFor(manager.dataPlane.dataDir) } : {}),
      adapters: { webFetchProvider, webSearchProvider },
    });
    const projector = createOutboxProjector(sidecar, nuclear, {
      // Growth V1 §5.5: pause defers her own initiative; nothing is dropped,
      // and speech Alex asked for is never held (initiative/reach-out-gate.ts).
      gate: (deliveryIntent) => evaluateReachOutGate(deliveryIntent, {
        paused: manager.core.getProactiveOperationalStatus(deliveryIntent.ownerId).paused,
        chatInProgress: !manager.core.isExpressionQuiesced(deliveryIntent.ownerId),
      }),
    });
    const runDetachedWorker = async (workerInput: Parameters<NonNullable<Parameters<typeof dispatchDetachedOperation>[2]>>[0]) => {
      const result = await liveOperationExecutors.runDetachedInvestigate({
        request: workerInput.request,
        operationId: workerInput.operation.operationId,
        conversationId: workerInput.operation.conversationId,
        cycleId: workerInput.operation.originCycleId,
        generation: workerInput.operation.originGeneration,
        purpose: workerInput.purpose,
        deadlineAtMs: workerInput.operation.operationDeadlineAtMs,
      });
      if (result.license.state === "succeeded") {
        return { ok: true as const, payload: result.payload };
      }
      const payload = (result.payload ?? {}) as Record<string, unknown>;
      return {
        ok: false as const,
        errorCode: typeof result.license.error === "string" && result.license.error.length > 0
          ? result.license.error
          : `worker_${result.license.state}`,
        ...(payload.failureEvidence !== undefined ? { failureEvidence: payload.failureEvidence } : {}),
      };
    };
    const detachedCapacityProbe = () => liveOperationExecutors.probeDetachedInvestigate();
    const commitmentCurrent = (undertaking: import("./core/cognitive-v021/operation/worker-queue.js").WorkerUndertakingRecord): boolean => {
      if (undertaking.originKind !== "ASHLEY_COMMITMENT") return true;
      const opportunity = getCommitmentOpportunity(nuclear, {
        ownerId: undertaking.ownerId,
        commitmentId: undertaking.originRef,
      });
      return opportunity !== null
        && ["admitted", "communicated", "attempted", "deferred_blocked"].includes(opportunity.state);
    };
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
      dataDir: manager.dataPlane.dataDir,
      attentionDb: nuclear,
      completeChat,
      // Thought's surfaceDraft is Ashley's own voice. The separate Expression
      // rewrite (a smaller model with no identity context) is retired: it
      // could only flatten her words. Owner decision 2026-09-29.
      expressionEnabled: false,
      runPerception: async (input): Promise<Observation[]> => runPerceptionBeforeThought({
        ...input,
        runPerception: async () => [],
      }),
      executeObservation: liveOperationExecutors.executeObservation,
      canOfferDirectProjectInspection: liveOperationExecutors.canOfferDirectProjectInspection,
      executeEffect: liveOperationExecutors.executeEffect,
      checkAuthority: (stage, input) => checkAuthority(stage, {
        ...input,
        receiptDb: sidecar,
      }),
      loadAuthorityPacks: () => loadAuthorityPacks(sidecar, {
        capability: getCapabilityReality(nuclear, {
          webFetchProvider,
          webSearchProvider,
          visionTransport,
        }),
        authorityDb: nuclear,
        receiptLimit: 256,
      }),
      projectOutbox: (outboxId) => projector.project(outboxId),
      projectSystemNotice: (noticeId) => projector.projectSystem(noticeId),
      projectInterim: (interimId) => projector.projectInterim(interimId),
      enqueueWorkerUndertaking: (input) => enqueueWorkerUndertakingIntent(sidecar, input),
      constitution: readIdentitySlice(nuclear, ownerId),
      readConstitution: () => readIdentitySlice(nuclear, ownerId),
      identityOwnerId: ownerId,
      embedQuery: async (text) => {
        const embedder = await localEmbedder();
        if (!embedder) return null;
        // A slow model never holds up a turn: recall falls back to lexical.
        const vector = await Promise.race([
          embedder.embed([text.slice(0, 2_000)]).then(([value]) => value ?? null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
        ]);
        return vector ? { model: embedder.model, vector } : null;
      },
      capabilityReality,
      visionTransport,
      refreshCapabilityReality: ({ audience, licenses, nowMs }) => getCapabilityReality(nuclear, {
        audience,
        licenses,
        nowMs,
        webFetchProvider,
        webSearchProvider,
        visionTransport,
      }),
      derivedStore,
      observabilityDb,
    };
    manager.configureCognitiveDispatch({ deps, projector });
    reconcileStartupOwnership(sidecar);
    // B3: what she wished to say in another place is written there, by her Thought held in that place.
    const placeComposer = thoughtPlaceComposer(sidecar, nuclear, deps, { timeZone: env.ownerTimeZone || DEFAULT_OWNER_TIME_ZONE });
    let composingPlaceWishes = false;
    setInterval(() => {
      if (composingPlaceWishes) return;
      composingPlaceWishes = true;
      const nowMs = Date.now();
      const ownerId = env.discordOwnerId.trim();
      const held = placesHeld(sidecar, { proactivePaused: !!ownerId && manager.core.isProactivePaused(ownerId), nowMs });
      void composeDuePlaceWishes(sidecar, nuclear, { nowMs, compose: placeComposer, held })
        .catch((error) => console.warn("[places] compose deferred", error instanceof Error ? error.message : error))
        .finally(() => { composingPlaceWishes = false; });
    }, 20_000).unref();
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
    if (!isThalamusEnabled()) {
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
    try {
      const failedSpeechRecovery = reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, ownerId);
      if (failedSpeechRecovery.recovered > 0) {
        console.log(
          `[cognitive-v021] unfulfilled failed speech recovered rows=${failedSpeechRecovery.recovered}`,
        );
      }
    } catch (error) {
      console.warn("[cognitive-v021] unfulfilled_failed_speech_recovery_deferred", error);
    }
    try {
      const orphanedSending = reconcileOrphanedSendingDeliveries(nuclear, sidecar, ownerId);
      if (orphanedSending.expired > 0) {
        console.log(
          `[cognitive-v021] orphaned sending expired without replay rows=${orphanedSending.expired}`,
        );
      }
    } catch (error) {
      console.warn("[cognitive-v021] orphaned_sending_recovery_deferred", error);
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
      for (const noticeId of ownerRecovery.finalFailureNoticeIds) {
        void projector.projectSystem(noticeId).catch(() => undefined);
      }
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
    try {
      const waiting = await serviceWorkerUndertakings(
        sidecar,
        { worker: runDetachedWorker, capacityProbe: detachedCapacityProbe, commitmentCurrent, nowMs: Date.now(), limit: 5 },
      );
      if (waiting.failures.length > 0) {
        console.warn(`[cognitive-v021] worker_queue_maintenance_deferred rows=${waiting.failures.length}`);
      }
    } catch (error) {
      console.warn("[cognitive-v021] worker_queue_startup_deferred", error);
    }
    // Growth V1 inner life: one inner pass at a time, polled from consumer
    // maintenance. A due afterglow always goes first, then a due NIGHT; AWAKE
    // runs only when there is nothing left to reflect on.
    let innerRunning = false;
    let innerLastPollMs = 0;
    const pollInnerLife = (nowMs: number): void => {
      const awakeEnabled = isPeriodicCognitionEnabled();
      const thalamusEnabled=isThalamusEnabled();
      if ((!thalamusEnabled && !env.afterglowEnabled && !awakeEnabled) || innerRunning || manager.isPaused()) return;
      if (nowMs - innerLastPollMs < (thalamusEnabled?THALAMUS_PARAMETERS.schedulerPollMs.default:AFTERGLOW_POLL_MS)) return;
      innerRunning = true;
      innerLastPollMs = nowMs;
      void (async () => {
        if(thalamusEnabled){
          const result=await manager.tickCognitiveThalamus(ownerId,nowMs,env.afterglowEnabled,awakeEnabled);
          if(result.kind==="evaluated")console.log(`[cognitive-v021] thalamus ${result.decision.kind} reason=${result.decision.reason}`);
          return;
        }
        if (env.afterglowEnabled) {
          const result = await manager.tickCognitiveAfterglow(ownerId, nowMs);
          if (result.outcome === "ran" || result.outcome === "abandoned") {
            console.log(`[cognitive-v021] afterglow ${result.outcome} mode=${result.mode ?? "?"} rows=${result.coveredRows ?? 0} reason=${result.thought?.reason ?? "none"}`);
          }
          if (result.outcome === "ran") return;
        }
        if (awakeEnabled) {
          // The night comes before the day's own time: it runs at most once a day.
          const night = await manager.tickCognitiveNight(ownerId, nowMs, env.afterglowEnabled);
          if (night.outcome === "ran" || night.outcome === "scheduled") {
            console.log(`[cognitive-v021] night ${night.outcome} slot=${night.slot ?? 0} weekly=${night.weekly ?? false} quietHour=${night.quietHour ?? "?"} next=${night.nextNightAtMs ? new Date(night.nextNightAtMs).toISOString() : "?"} reason=${night.thought?.reason ?? "none"}`);
          }
          if (night.outcome === "ran") return;
          const result = await manager.tickCognitiveAwake(ownerId, nowMs, env.afterglowEnabled);
          if (result.outcome === "ran" || result.outcome === "scheduled") {
            console.log(`[cognitive-v021] awake ${result.outcome} slot=${result.slot ?? 0} next=${result.nextAwakeAtMs ? new Date(result.nextAwakeAtMs).toISOString() : "?"} reason=${result.thought?.reason ?? "none"}`);
          }
        }
      })()
        .catch((error) => console.warn("[cognitive-v021] inner life deferred", error))
        .finally(() => {
          innerRunning = false;
        });
    };
    // E1: the game lane is polled on its own, beside her inner life: a game moment is weighed at once
    // when it arrives or when her last game pass ends, and never waits for a Discord turn.
    let laneRunning = false;
    let laneAgain = false;
    let laneLastPollMs = 0;
    const pollDomusLane = (nowMs: number, now = false): void => {
      if (!isThalamusEnabled() || manager.isPaused()) return;
      if (laneRunning) { laneAgain ||= now; return; }
      if (!now && nowMs - laneLastPollMs < THALAMUS_PARAMETERS.schedulerPollMs.default) return;
      laneRunning = true;
      laneAgain = false;
      laneLastPollMs = nowMs;
      void manager.tickDomusLane(ownerId, nowMs)
        .then((result) => { if (result.kind === "evaluated") console.log(`[domus] lane ${result.decision.kind} reason=${result.decision.reason}`); })
        .catch((error) => console.warn("[domus] lane deferred", error))
        .finally(() => {
          laneRunning = false;
          if (laneAgain) setImmediate(() => pollDomusLane(Date.now(), true));
        });
    };
    onDomusArrival = () => pollDomusLane(Date.now(), true);
    if (env.privateThoughtBudgetLimit > 0) {
      try {
        configurePrivateThoughtBudget(sidecar, { limit: env.privateThoughtBudgetLimit, version: env.privateThoughtBudgetVersion });
      } catch (error) {
        console.warn(`[initiative] private_thought_budget_unconfigured code=${error instanceof Error ? error.message : "unknown"}`);
      }
    }
    if (env.embodimentBudgetLimit > 0) {
      try {
        configureEmbodimentBudget(sidecar, { limit: env.embodimentBudgetLimit, version: env.embodimentBudgetVersion });
      } catch (error) {
        // A changed limit needs a higher version; until then Domus passes keep the current policy or stay off.
        console.warn(`[domus] embodiment_budget_unconfigured code=${error instanceof Error ? error.message : "unknown"}`);
      }
    }
    selfChangeResultMaintenance = createSelfChangeResultMaintenance(sidecar, {
      directory: join(manager.dataPlane.dataDir, "self-change", "results"),
      conversationId: () => {
        const row = nuclear.prepare("SELECT id FROM mem_threads WHERE owner_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1").get(ownerId) as { id?: unknown } | undefined;
        return typeof row?.id === "string" ? row.id : null;
      },
      config: () => ({ enabled: process.env.ASHLEY_SELF_CHANGE_RESULTS_ENABLED === "true", key: process.env.ASHLEY_SELF_CHANGE_RESULT_KEY ?? "" }),
    });
    const consumerHandler = createAgentInboxConsumerHandler(manager);
    // E1: the game lane's own worker. A game thought and a Discord turn run side by side; when a game
    // pass ends the lane is weighed again at once.
    const laneConsumer = startInboxConsumer(sidecar, {
      workerId: `agent-service:${process.pid}:domus`,
      conversationId: domusLaneId(ownerId),
      steadyStateReconciliation: false,
      handler: async (event) => {
        try {
          return await consumerHandler(event);
        } finally {
          setImmediate(() => pollDomusLane(Date.now(), true));
        }
      },
      onError: (error, event) => console.error(`[domus] lane event failed id=${event?.id ?? "?"}`, error),
    });
    const mainConsumer = startInboxConsumer(sidecar, {
      workerId: `agent-service:${process.pid}`,
      excludeConversationPrefix: DOMUS_LANE_PREFIX,
      handler: consumerHandler,
      onReconciliationMaintenance: (nowMs) => {
        if (!manager.isPaused()) void selfChangeResultMaintenance?.poll(nowMs)
          .then(() => { lastSelfChangeResultMaintenanceCode = null; })
          .catch((error: unknown) => {
            const code = selfChangeResultMaintenanceCode(error);
            if (code === lastSelfChangeResultMaintenanceCode) return;
            lastSelfChangeResultMaintenanceCode = code;
            console.warn(`[self-change] result_maintenance_deferred code=${code}`);
          });
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
        // A8: once a week, record who she is for the growth-versus-drift witness.
        try {
          takePersonaSnapshotIfDue(sidecar, { nuclear, ownerId }, nowMs);
        } catch (error) {
          console.warn("[cognitive-v021] persona snapshot deferred", error);
        }
        // A5: keep the local vector index in step with live memory, one refresh at a time.
        if (derivedStore && !vectorRefreshRunning && env.localEmbeddingsEnabled && env.localEmbeddingModel) {
          vectorRefreshRunning = true;
          const store = derivedStore;
          void localEmbedder()
            .then((embedder) => embedder ? refreshMemoryVectors(store, sidecar, embedder, { nowMs }) : null)
            .catch((error) => console.warn("[cognitive-v021] vector refresh deferred", error))
            .finally(() => { vectorRefreshRunning = false; });
        }
        // R1 steady-state opportunity: newly terminalized eligible obligations
        // materialize a repair here; the pass is bounded and idempotent.
        try {
          const ownerRecovery = serviceUnansweredOwnerRecovery(sidecar, { nowMs });
          for (const noticeId of ownerRecovery.finalFailureNoticeIds) {
            void projector.projectSystem(noticeId).catch(() => undefined);
          }
        } catch (error) {
          console.warn("[cognitive-v021] unanswered owner recovery maintenance deferred", error);
        }
        void serviceWorkerUndertakings(
          sidecar,
          { worker: runDetachedWorker, capacityProbe: detachedCapacityProbe, commitmentCurrent, nowMs, limit: 5 },
        ).catch((error) => {
          console.warn("[cognitive-v021] worker_queue_maintenance_deferred", error);
        });
        try {
          sweepExpiredArtifacts(nuclear, { nowMs, limit: 50 });
        } catch (error) {
          console.warn("[perception] artifact retention maintenance deferred", error);
        }
        // R13: replay inner-life records a crash left owed after publication.
        try {
          recoverSettlementAftermath(sidecar, {
            identityStore: { nuclear, ownerId },
            dataDir: manager.dataPlane.dataDir,
            timeZone: env.ownerTimeZone || DEFAULT_OWNER_TIME_ZONE,
            nowMs,
            limit: 10,
          });
        } catch (error) {
          console.warn("[cognitive-v021] aftermath recovery deferred", error);
        }
        if (observabilityDb) purgeThoughtDebugCaptures(observabilityDb, nowMs);
        if (observabilityDb && nowMs - wordWatchAtMs >= WORD_WATCH_EVERY_MS) {
          wordWatchAtMs = nowMs;
          try {
            const flags = scanWordWatch(sidecar, observabilityDb, { terms: loadWatchTerms(env.wordWatchFile), nowMs });
            if (flags.length > 0) {
              console.log(`[watch] flagged=${flags.length} surfaces=${[...new Set(flags.map(item => item.surface))].join(",")}`);
              void notifyWatch(env.wordWatchWebhook, flags);
            }
          } catch (error) {
            console.warn(`[watch] scan deferred: ${error instanceof Error ? error.name : "error"}`);
          }
        }
        pollInnerLife(nowMs);
        pollDomusLane(nowMs);
      },
      onError: (error, event) => console.error(`[cognitive-v021] event failed id=${event?.id ?? "?"}`, error),
    });
    cognitiveConsumer = {
      stop: () => { mainConsumer.stop(); laneConsumer.stop(); },
      done: Promise.all([mainConsumer.done, laneConsumer.done]).then(() => undefined),
    };
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
    const domusDecision = decideDomusIngress({
      helperToken: env.domusHelperToken,
      botToken: process.env.DISCORD_BOT_TOKEN ?? "",
    });
    if (domusDecision.enabled && cognitiveSidecar) {
      domusServer = createDomusIngressApp({
        db: cognitiveSidecar,
        token: env.domusHelperToken,
        botToken: process.env.DISCORD_BOT_TOKEN ?? "",
        now: () => Date.now(),
        onAdmitted: () => onDomusArrival(),
        ...(observabilityDb ? { observability: observabilityDb } : {}),
        build: agentBuild(),
        ...(manager.dataPlane?.dataDir ? { snapshotDir: domusSnapshotDirFor(manager.dataPlane.dataDir) } : {}),
      }).listen(env.domusIngressPort, "127.0.0.1");
    } else if (!domusDecision.enabled) {
      console.log(`[domus-ingress] disabled: ${domusDecision.reason}`);
    }
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
      { cognitiveConsumer, frontierCoordinator, derivedStore, observabilityDb, selfChangeResultMaintenance, domusServer },
      server,
      signal,
    );
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  } catch (error) {
    await closeStartupResources(manager, {
      cognitiveSidecar,
      domusServer,
      selfChangeResultMaintenance,
      cognitiveConsumer,
      frontierCoordinator,
      derivedStore,
      observabilityDb,
    });
    throw error;
  }
}

/** E4: how often the word watch reads her new lines. */
const WORD_WATCH_EVERY_MS = 30_000;

/** E4: the commit this agent runs (the deploy checks it out), carried on each pass's regime. */
function agentBuild(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 })
      .trim().slice(0, 40) || "unknown";
  } catch { return "unknown"; }
}
