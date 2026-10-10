import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "./db.js";
import { loadNuclearSystemPrompt } from "./conversation/prompts.js";
import { emptyActivityLicenseNote } from "./honesty/activity-license.js";
import { buildIdentityBlock } from "./identity/store.js";
import {
  boundedOperationEvidenceBlock,
  candidateAuthorshipEvidenceBlock,
  candidateVerificationEvidenceBlock,
  candidateWorkspaceEvidenceBlock,
  patchExportEvidenceBlock,
  projectInspectionEvidenceBlock,
  stableIdentityBlock,
} from "./context-composer.js";
import {
  EPISTEMIC_DIMENSIONS,
  GROWTH_GUIDANCE,
  THOUGHT_OUTPUT_SCHEMA,
  thoughtOutputCompatibilityInstruction,
  thoughtOutputDeepSeekJsonObjectInstruction,
} from "./cognitive-v021/thought/output-contract.js";
import {
  REFLECTION_INITIATIVE_OUTPUT_SCHEMA,
  reflectionInitiativeJsonObjectInstruction,
} from "./cognitive-v021/thought/reflection-output-contract.js";
import {
  VISION_MEDIA_OUTPUT_SCHEMA,
  visionMediaJsonObjectInstruction,
} from "./cognitive-v021/perception/vision-output-contract.js";

/**
 * Hashes model-visible and person-visible text at the base names.
 * A zero-arg function is called so a const can become a function without a new hash.
 */
function pin(value: unknown): string {
  const resolved = typeof value === "function" ? (value as () => unknown)() : value;
  const text = typeof resolved === "string" ? resolved : JSON.stringify(resolved);
  return createHash("sha256").update(text).digest("hex");
}

const EXPECTED = {
  "prompt.discord": "5393a9b97b0d63fa3ce8608d287c312a022de842263c710165ddd6d94aac0f2e",
  "prompt.proactive": "69514df99df10b018e7668ebeceb6ecb4c93ed40d706c45125e7fb0a0ddcb408",
  "thought.schema": "236424fdd75d95b95fdd5a764d03e8df511991ab1ba564c89e67c96a805a680b",
  "thought.deepseek": "d5d00085a92fb9d27432669eaafaf1d259ad092ceb29ac6d7b79253280d05899",
  "thought.growth": "8c1138b2c18691a18c1f96a8897e666967c1ab9379fd37f8c1841adad0b80460",
  "thought.compatibility": "6634a29dbf93d792286048f5a6e0b46784cf715926b36de5cdd58ba8ca1929f2",
  "thought.epistemic": "ef2eb8d834badce08928cd933faa32711727bb0b3ec7e82f1ca74afc910216a4",
  "reflection.schema": "4e84eec80aec8b8354ac0ec0035d68463452686f9ae870816fd29befb01263a4",
  "reflection.protocol": "b485409c37d50424bba4484a8224fd41e6dd75668efc584a4fa05f00f7e65a07",
  "vision.schema": "f4be7072a9cf2cb723f2dece086d46e8551f0500ff49233702b2310d3c9d2bd9",
  "vision.protocol": "73f076f34e5ac720510620c240e9f0e248a5e7979b0e010f2789da384ed0830a",
  "activity.emptyNote": "0f08dc9e4d935fb3b408705264dd56cf73be0063d83e978471975d6bac29b80c",
  "composer.stableIdentity": "b8b6e150fe14a74894b840ad4a686a98c3ed009c67735b0d1ef28b12537b30ff",
  "composer.inspection.off": "60821b1c1b899e55c1a4f10082075ad1e9696284d1877a66872a5941265368a9",
  "composer.inspection.on": "9587411ac264df3b24af2090f46b270bb26bfb015f4f166e9295da697c3fc72b",
  "composer.workspace.off": "4e2169ea2c308b3c12720605fe34f5c7d60d24508278f78bc8dd9b8de3799ec0",
  "composer.workspace.on": "caeb723e092900b96b5bda40ba3a4fc3150e20506871275af902431f7b7a5331",
  "composer.verification.off": "3dd4ae7ebb17480f242adc31651091200c6b265b118011032f7c6921b2e2b2cb",
  "composer.verification.on": "9dd2cba7d95255fee9ca547c3083eabceba840e0f72cd4ce99a571b8eb09e8b3",
  "composer.authorship.off": "71e0c04e2b4498c4d6c09c35146612c313613d3ac5d5e8dabd605d6b901fb4d1",
  "composer.authorship.on": "2ada8e020d61c7235272d2643618456cc6954f2ddf6d35e2e7248ec0b1578778",
  "composer.bounded.off": "ca95581c276991b86372f63ca63df708f6ad6f8bdc6c31795da16260d7b5fcdc",
  "composer.bounded.on": "a00ca87cfb3c6208d322d960ea7a9877a623652f9d1c629564552aafe9fccc14",
  "composer.patch.off": "f4d38a0b4b8bdfd3de088091fb4ef38cb6596affb8ab28cbdcb6e4242bd8efed",
  "composer.patch.on": "f1bea04208e74839654731bcbe16b581db4401bda1fc483064733c0ceb69e026",
  "identity.block": "de6520af02d20406a3e6231db356678c2d0ed238ac28ffe1587787925ab3afd4",
} as const;

describe("entity name golden hashes", () => {
  it("pins model-visible and person-visible text that contains the default names", () => {
    delete process.env.ASHLEY_ENTITY_NAME;
    delete process.env.ASHLEY_OWNER_NAME;
    delete process.env.ASHLEY_CHANNELS;
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const actual = {
      "prompt.discord": pin(loadNuclearSystemPrompt("discord")),
      "prompt.proactive": pin(loadNuclearSystemPrompt("proactive")),
      "thought.schema": pin(THOUGHT_OUTPUT_SCHEMA),
      "thought.deepseek": pin(thoughtOutputDeepSeekJsonObjectInstruction),
      "thought.growth": pin(GROWTH_GUIDANCE),
      "thought.compatibility": pin(thoughtOutputCompatibilityInstruction),
      "thought.epistemic": pin(EPISTEMIC_DIMENSIONS),
      "reflection.schema": pin(REFLECTION_INITIATIVE_OUTPUT_SCHEMA),
      "reflection.protocol": pin(reflectionInitiativeJsonObjectInstruction),
      "vision.schema": pin(VISION_MEDIA_OUTPUT_SCHEMA),
      "vision.protocol": pin(visionMediaJsonObjectInstruction),
      "activity.emptyNote": pin(emptyActivityLicenseNote),
      "composer.stableIdentity": pin(stableIdentityBlock(db, "doc")),
      "composer.inspection.off": pin(projectInspectionEvidenceBlock(null, null, {})),
      "composer.inspection.on": pin(projectInspectionEvidenceBlock(null, null, { capabilityAvailable: true })),
      "composer.workspace.off": pin(candidateWorkspaceEvidenceBlock(null, null, {})),
      "composer.workspace.on": pin(candidateWorkspaceEvidenceBlock(null, null, { capabilityAvailable: true })),
      "composer.verification.off": pin(candidateVerificationEvidenceBlock(null, {})),
      "composer.verification.on": pin(candidateVerificationEvidenceBlock(null, { capabilityAvailable: true })),
      "composer.authorship.off": pin(candidateAuthorshipEvidenceBlock(null, {})),
      "composer.authorship.on": pin(candidateAuthorshipEvidenceBlock(null, { capabilityAvailable: true })),
      "composer.bounded.off": pin(boundedOperationEvidenceBlock(null, {})),
      "composer.bounded.on": pin(boundedOperationEvidenceBlock(null, { capabilityAvailable: true })),
      "composer.patch.off": pin(patchExportEvidenceBlock(null, {})),
      "composer.patch.on": pin(patchExportEvidenceBlock(null, { capabilityAvailable: true })),
      "identity.block": pin(buildIdentityBlock(db, "doc")),
    };
    db.close();
    expect(actual).toEqual(EXPECTED);
  });
});
