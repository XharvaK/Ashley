/**
 * Fail-closed credential-shape scan for M5 authorship artifacts.
 * Heuristic only. Never returns or logs the matched raw value.
 */

export type AuthorshipSecretHit = { hit: true; kind: string };
export type AuthorshipSecretMiss = { hit: false };

const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  {
    kind: "pem_private_key",
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    kind: "aws_access_key",
    re: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    kind: "github_pat",
    re: /\bghp_[A-Za-z0-9]{36,}\b/,
  },
  {
    kind: "github_oauth",
    re: /\bgho_[A-Za-z0-9]{36,}\b/,
  },
  {
    kind: "slack_token",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    kind: "bearer_jwt",
    re: /\bBearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/i,
  },
  {
    kind: "openai_sk",
    re: /\bsk-[A-Za-z0-9]{20,}\b/,
  },
  {
    kind: "generic_api_key_assignment",
    re: /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_\-/.+=]{20,}['"]?/i,
  },
];

export function scanAuthorshipText(text: string): AuthorshipSecretHit | AuthorshipSecretMiss {
  if (!text || text.length < 8) return { hit: false };
  for (const pattern of PATTERNS) {
    if (pattern.re.test(text)) {
      return { hit: true, kind: pattern.kind };
    }
  }
  return { hit: false };
}
