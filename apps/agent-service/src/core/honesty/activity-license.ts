export type ActivityLicenseSource = "read_records" | "page" | "lookup";

export type ActivityLicense = {
  readingLicensed: boolean;
  sources: ActivityLicenseSource[];
  allowedRefs: string[];
  note: string;
};

export type ActivityLicenseInput = {
  readRecordIds?: number[];
  readTitles?: string[];
  pageContext?: string | null;
  searchContext?: string | null;
};

const EMPTY_NOTE =
  "There is no reading-claim license for this turn. Claim nothing about reading, browsing, skimming, looking something up, or naming a piece. If Doc asks directly, answer plainly that you have not read or checked it; do not turn that into a blanket claim that browsing or opening links is impossible. This note licenses claims only: it is not an execution license, never grants a capability, and never blocks a capability attempt — repository inspection and other actions are governed by the capability self-model and runtime authority, not by this note. Never mention notes, licenses, or authorization.";

function refsFromText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const bullet = line.match(/^\s*-\s+(.+?)(?::\s|$)/);
      if (bullet?.[1]) return bullet[1].trim().slice(0, 120);
      const url = line.match(/https?:\/\/\S+/i);
      return url?.[0]?.slice(0, 120) ?? "";
    })
    .filter(Boolean);
}

export function computeActivityLicense(
  input: ActivityLicenseInput,
): ActivityLicense {
  const sources: ActivityLicenseSource[] = [];
  const refs: string[] = [];
  const readRecordIds = input.readRecordIds ?? [];
  if (readRecordIds.length > 0) {
    sources.push("read_records");
    refs.push(
      ...(input.readTitles ?? []).map((title) => title.trim()).filter(Boolean),
    );
  }
  if (input.pageContext?.trim()) {
    sources.push("page");
    refs.push(...refsFromText(input.pageContext));
  }
  if (input.searchContext?.trim()) {
    sources.push("lookup");
    refs.push(...refsFromText(input.searchContext));
  }
  const seen = new Set<string>();
  const allowedRefs = refs.filter((ref) => {
    const key = ref.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (sources.length === 0) {
    return {
      readingLicensed: false,
      sources,
      allowedRefs,
      note: EMPTY_NOTE,
    };
  }
  const refsNote =
    allowedRefs.length > 0
      ? ` Prefer these references only: ${allowedRefs.slice(0, 4).join("; ")}.`
      : "";
  return {
    readingLicensed: true,
    sources,
    allowedRefs,
    note: `This turn has a reading activity note (${sources.join("|")}). Do not invent titles beyond it.${refsNote}`,
  };
}

export function emptyActivityLicenseNote(): string {
  return EMPTY_NOTE;
}
