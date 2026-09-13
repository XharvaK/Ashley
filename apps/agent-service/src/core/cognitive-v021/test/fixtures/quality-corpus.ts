import type { AssertionKey, EpistemicDimensions, MemoryKind } from "../../types.js";

export type QualityCorpusScenario = {
  name: string;
  description: string;
  triggerText: string;
  rawConversation: Array<{
    role: "owner" | "ashley" | "system";
    text: string;
  }>;
  memoryAssertions: Array<{
    assertionKey: AssertionKey;
    statement: string;
    memoryKind: MemoryKind;
    dimensions: EpistemicDimensions;
    dataClassification: "ordinary" | "sensitive" | "never_public" | "secret";
    live: boolean;
    lineageParentKey?: string | null;
  }>;
  workingContext: Array<{
    id: string;
    type: "correction" | "referent" | "repair" | "commitment_temp" | "topic" | "owner_teaching";
    text: string;
    concernId?: string;
  }>;
  concerns?: Array<{
    concernId: string;
    assertionKey: string | null;
  }>;
  expected: {
    requiredEvidence: AssertionKey[];
    allowedOptional: AssertionKey[];
    dangerousIrrelevant: AssertionKey[];
    acceptableOmission: AssertionKey[];
    expectMiss?: boolean;
    wcRequiredPreserved: boolean;
  };
};

const defaultDimensions: EpistemicDimensions = {
  source: "owner_utterance",
  status: "asserted",
  time: "current",
  reliability: "owner_supplied",
};

export const QUALITY_CORPUS_SCENARIOS: QualityCorpusScenario[] = [
  {
    name: "casual_goodnight_near_zero",
    description: "Incident C casual goodnight turn. Irrelevant sleep assertions must not flood Thought context.",
    triggerText: "I need to sleep soon - let's talk tomorrow, ok?",
    rawConversation: [
      { role: "owner", text: "I need to sleep soon - let's talk tomorrow, ok?" },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:sleep:1",
        statement: "Owner mentioned sleep routine 3 weeks ago",
        memoryKind: "owner_preference",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
      {
        assertionKey: "mem:arch:1",
        statement: "Project Ashley uses SQLite for nuclear DB",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    workingContext: [],
    expected: {
      requiredEvidence: [],
      allowedOptional: ["mem:sleep:1"],
      dangerousIrrelevant: ["mem:arch:1"],
      acceptableOmission: ["mem:sleep:1", "mem:arch:1"],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "recent_callback",
    description: "Owner asks about recent discussion regarding database optimization.",
    triggerText: "How did we decide to optimize the SQLite database?",
    rawConversation: [
      { role: "ashley", text: "We discussed index layout yesterday." },
      { role: "owner", text: "How did we decide to optimize the SQLite database?" },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:sqlite:opt",
        statement: "We decided to optimize SQLite using dedicated derived FTS5 indices",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
      {
        assertionKey: "mem:unrelated:weather",
        statement: "Berlin weather was sunny yesterday",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    workingContext: [],
    expected: {
      requiredEvidence: ["mem:sqlite:opt"],
      allowedOptional: [],
      dangerousIrrelevant: ["mem:unrelated:weather"],
      acceptableOmission: ["mem:unrelated:weather"],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "old_fact_recall",
    description: "Recall specific historical fact about owner preferences.",
    triggerText: "Do you remember what coffee roast I drink?",
    rawConversation: [
      { role: "owner", text: "Do you remember what coffee roast I drink?" },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:pref:coffee",
        statement: "Owner prefers medium-dark Ethiopian coffee roast",
        memoryKind: "owner_preference",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    workingContext: [],
    expected: {
      requiredEvidence: ["mem:pref:coffee"],
      allowedOptional: [],
      dangerousIrrelevant: [],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "owner_correction",
    description: "Correction in working context must never be displaced by retrieval.",
    triggerText: "Wait, I actually moved to Munich, not Berlin.",
    rawConversation: [
      { role: "owner", text: "Wait, I actually moved to Munich, not Berlin." },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:loc:berlin",
        statement: "Owner lives in Berlin",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    workingContext: [
      {
        id: "wc-corr-1",
        type: "correction",
        text: "Owner corrected city of residence to Munich",
      },
    ],
    expected: {
      requiredEvidence: [],
      allowedOptional: ["mem:loc:berlin"],
      dangerousIrrelevant: [],
      acceptableOmission: ["mem:loc:berlin"],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "supersession",
    description: "Superseded assertions should be ordered after active ones.",
    triggerText: "What is my current laptop model?",
    rawConversation: [
      { role: "owner", text: "What is my current laptop model?" },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:laptop:old",
        statement: "Owner uses ThinkPad X1 Carbon laptop",
        memoryKind: "owner_world_claim",
        dimensions: { ...defaultDimensions, status: "superseded" },
        dataClassification: "ordinary",
        live: false,
      },
      {
        assertionKey: "mem:laptop:new",
        statement: "Owner uses MacBook Pro M3 laptop model",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    workingContext: [],
    expected: {
      requiredEvidence: ["mem:laptop:new"],
      allowedOptional: ["mem:laptop:old"],
      dangerousIrrelevant: [],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "contradiction",
    description: "Both sides of a contradiction remain visible if active.",
    triggerText: "Tell me about our project deployment host requirements.",
    rawConversation: [
      { role: "owner", text: "Tell me about our project deployment host requirements." },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:host:mint",
        statement: "Deployment host must be Linux Mint for Project Ashley production",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
      {
        assertionKey: "mem:host:ubuntu",
        statement: "Some staging tests run on Ubuntu container host",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    workingContext: [],
    expected: {
      requiredEvidence: ["mem:host:mint"],
      allowedOptional: ["mem:host:ubuntu"],
      dangerousIrrelevant: [],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "unresolved_commitment",
    description: "Active commitment in working context must be preserved unconditionally.",
    triggerText: "Let's review our open tasks.",
    rawConversation: [
      { role: "owner", text: "Let's review our open tasks." },
    ],
    memoryAssertions: [],
    workingContext: [
      {
        id: "wc-commit-1",
        type: "commitment_temp",
        text: "Ashley committed to audit thought projection allocator test coverage",
      },
    ],
    expected: {
      requiredEvidence: [],
      allowedOptional: [],
      dangerousIrrelevant: [],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "future_concern_reference",
    description: "Concern anchor with non-null assertionKey resolves as Tier 1 exact-key hit.",
    triggerText: "How are we doing on the memory subsystem?",
    rawConversation: [
      { role: "owner", text: "How are we doing on the memory subsystem?" },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:subsystem:memory",
        statement: "Memory subsystem requires zero unbounded substring scans",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    concerns: [
      {
        concernId: "c-mem-1",
        assertionKey: "mem:subsystem:memory",
      },
    ],
    workingContext: [
      {
        id: "wc-top-1",
        type: "topic",
        text: "Memory subsystem audit",
        concernId: "c-mem-1",
      },
    ],
    expected: {
      requiredEvidence: ["mem:subsystem:memory"],
      allowedOptional: [],
      dangerousIrrelevant: [],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "technical_identifiers",
    description: "Technical IDs HY3, M4, GPT, LLM, API, Qwen must be retrievable whole-token.",
    triggerText: "What is the status of the HY3 engine on M4 hardware?",
    rawConversation: [
      { role: "owner", text: "What is the status of the HY3 engine on M4 hardware?" },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:tech:hy3",
        statement: "The HY3 engine runs on M4 architecture with GPT and Qwen support",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    workingContext: [],
    expected: {
      requiredEvidence: ["mem:tech:hy3"],
      allowedOptional: [],
      dangerousIrrelevant: [],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "identity_sensitive_retrieval",
    description: "Sensitive/never_public eligible for private context; secret strictly excluded.",
    triggerText: "Where do we keep our private backup keys?",
    rawConversation: [
      { role: "owner", text: "Where do we keep our private backup keys?" },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:priv:note",
        statement: "Private backup keys are encrypted in ~/.composer-assistant",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "sensitive",
        live: true,
      },
      {
        assertionKey: "mem:sec:raw",
        statement: "Raw master key is supersecret123",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "secret",
        live: true,
      },
    ],
    workingContext: [],
    expected: {
      requiredEvidence: ["mem:priv:note"],
      allowedOptional: [],
      dangerousIrrelevant: ["mem:sec:raw"],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "sparse_memory",
    description: "Memory store contains only 1 assertion; retrieval operates cleanly.",
    triggerText: "What is my username?",
    rawConversation: [
      { role: "owner", text: "What is my username?" },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:owner:user",
        statement: "Owner username handle is Xharv",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    workingContext: [],
    expected: {
      requiredEvidence: ["mem:owner:user"],
      allowedOptional: [],
      dangerousIrrelevant: [],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "large_memory_corpus",
    description: "500 assertions in memory; retrieval selects only relevant items.",
    triggerText: "Tell me about our vector embeddings policy.",
    rawConversation: [
      { role: "owner", text: "Tell me about our vector embeddings policy." },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:policy:vectors",
        statement: "Vector embeddings and neural rerankers are deferred in v0.2.1",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
      ...Array.from({ length: 100 }, (_, i) => ({
        assertionKey: `mem:noise:${i}`,
        statement: `Random background noise statement number ${i} about unrelated topic`,
        memoryKind: "owner_world_claim" as MemoryKind,
        dimensions: defaultDimensions,
        dataClassification: "ordinary" as const,
        live: true,
      })),
    ],
    workingContext: [],
    expected: {
      requiredEvidence: ["mem:policy:vectors"],
      allowedOptional: [],
      dangerousIrrelevant: [],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "multilingual_turkish",
    description: "Turkish characters ğüşıöç and accents normalize cleanly.",
    triggerText: "Bu Türkçe metin ve ğüşıöç karakterleri hakkında ne biliyorsun?",
    rawConversation: [
      { role: "owner", text: "Bu Türkçe metin ve ğüşıöç karakterleri hakkında ne biliyorsun?" },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:lang:tr",
        statement: "Türkçe dil desteği ve ğüşıöç harfleri başarıyla indekslenir",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    workingContext: [],
    expected: {
      requiredEvidence: ["mem:lang:tr"],
      allowedOptional: [],
      dangerousIrrelevant: [],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "multilingual_cjk",
    description: "CJK Unicode text is preserved in tokenization and search.",
    triggerText: "请告诉我关于 中文 和 日本語 的信息",
    rawConversation: [
      { role: "owner", text: "请告诉我关于 中文 和 日本語 的信息" },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:lang:cjk",
        statement: "系统支持 中文 语言和 日本語 テスト statement",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    workingContext: [],
    expected: {
      requiredEvidence: ["mem:lang:cjk"],
      allowedOptional: [],
      dangerousIrrelevant: [],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "long_owner_message",
    description: "1,800-character long owner message; required trigger preserved without overflow.",
    triggerText: "Detailed explanation of cognitive architecture: ".padEnd(1800, "X"),
    rawConversation: [
      { role: "owner", text: "Detailed explanation of cognitive architecture: ".padEnd(1800, "X") },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:arch:overview",
        statement: "Cognitive architecture consists of Identity, Mind State, Thought, and Agency",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    workingContext: [],
    expected: {
      requiredEvidence: ["mem:arch:overview"],
      allowedOptional: [],
      dangerousIrrelevant: [],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "ambiguous_referent",
    description: "Working context referent item is preserved as required context.",
    triggerText: "What do you think of it?",
    rawConversation: [
      { role: "owner", text: "What do you think of it?" },
    ],
    memoryAssertions: [],
    workingContext: [
      {
        id: "wc-ref-1",
        type: "referent",
        text: "Referent 'it' refers to the new ThoughtProjectionAllocator architecture",
      },
    ],
    expected: {
      requiredEvidence: [],
      allowedOptional: [],
      dangerousIrrelevant: [],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "raw_historical_evidence",
    description: "Conversation log fallback excludes rows already in raw conversation window.",
    triggerText: "Let's recall our previous discussion on memory deduplication.",
    rawConversation: [
      { role: "owner", text: "Let's recall our previous discussion on memory deduplication." },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:dedup:rules",
        statement: "Deduplication must never drop contradictory assertions with different dimensions",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    workingContext: [],
    expected: {
      requiredEvidence: ["mem:dedup:rules"],
      allowedOptional: [],
      dangerousIrrelevant: [],
      acceptableOmission: [],
      wcRequiredPreserved: true,
    },
  },
  {
    name: "retrieval_should_be_empty",
    description: "Query terms with no matching memory assertions produce clean miss (miss=true, hits=[]).",
    triggerText: "Zzxyqwk nonexistent query xyzzy",
    rawConversation: [
      { role: "owner", text: "Zzxyqwk nonexistent query xyzzy" },
    ],
    memoryAssertions: [
      {
        assertionKey: "mem:known:item",
        statement: "Known assertion about apples and oranges",
        memoryKind: "owner_world_claim",
        dimensions: defaultDimensions,
        dataClassification: "ordinary",
        live: true,
      },
    ],
    workingContext: [],
    expected: {
      requiredEvidence: [],
      allowedOptional: [],
      dangerousIrrelevant: ["mem:known:item"],
      acceptableOmission: ["mem:known:item"],
      expectMiss: true,
      wcRequiredPreserved: true,
    },
  },
];
