export const CATEGORY_LABELS: Record<string, string> = {
  pinned: "Pinned",
  project: "Project",
  preference: "Preference",
  person: "Identity",
  ongoing: "Ongoing",
};

export function formatFactLabel(category: string, value: string): string {
  const label = CATEGORY_LABELS[category] ?? category;
  return `[${label}] ${value}`;
}
