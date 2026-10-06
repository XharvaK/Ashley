import { timingSafeEqual } from "node:crypto";
import type express from "express";

/**
 * Bot → agent transport authentication (Stewardship Compact SC-ADM-02).
 *
 * The agent listens on loopback, but loopback is shared with every local
 * process, including the Command Code worker. Every route except /health
 * therefore requires the bot's service token, and admin acts additionally
 * require the bot to vouch that Alex initiated them (X-Ashley-Actor). A user
 * id in a request body is never proof of who is asking.
 */

export const BOT_SERVICE_HEADER = "X-Ashley-Bot-Service";
export const ACTOR_HEADER = "X-Ashley-Actor";

const UNAUTHENTICATED_PATHS = new Set(["/health"]);

/** Admin acts are Alex's alone (SC-ADM-01). Method + Express path pattern. */
export const ADMIN_ROUTES: ReadonlyArray<readonly ["POST", string]> = [
  ["POST", "/memory/forget"],
  ["POST", "/memory/forget/bind"],
  ["POST", "/memory/forget/resolve"],
  ["POST", "/nuclear/capabilities/promote"],
  ["POST", "/nuclear/capabilities/rollback"],
  ["POST", "/nuclear/capabilities/recall/cutover"],
  ["POST", "/nuclear/capabilities/recall/qualification-epoch/start"],
  ["POST", "/nuclear/capabilities/memory-evidence/qualification-epoch/start"],
  ["POST", "/nuclear/capabilities/memory-evidence/cutover"],
  ["POST", "/growth/self-change/ladder"],
  ["POST", "/growth/self-change/ladder/finding"],
  ["POST", "/growth/graduation/mode"],
  ["POST", "/growth/influences/mode"],
  ["POST", "/growth/graduation/adjudicate"],
  ["POST", "/growth/calibration/rollback"],
  ["POST", "/growth/revisions/revert"],
  ["POST", "/growth/identity/reviews/doc"],
  ["POST", "/nuclear/identity/proposals/:entityUuid/approve"],
  ["POST", "/nuclear/identity/proposals/:entityUuid/reject"],
  ["POST", "/nuclear/change-proposals/doc-decision"],
  ["POST", "/nuclear/social-operation-delegations"],
  ["POST", "/nuclear/social-operation-delegations/revoke"],
  ["POST", "/social/contacts"],
  ["POST", "/social/contacts/revoke"],
  ["POST", "/places/switch"],
  ["POST", "/nuclear/external/actions/:entityUuid/cancel"],
  ["POST", "/nuclear/external/credentials/:credentialRef/revoke"],
  ["POST", "/nuclear/external/emergency-stop"],
  ["POST", "/initiative/pause"],
  ["POST", "/initiative/resume"],
  ["POST", "/initiative/periodic/debug/enable"],
];

const ADMIN_MATCHERS = ADMIN_ROUTES.map(([method, path]) => ({
  method,
  pattern: new RegExp(`^${path.replace(/:[A-Za-z]+/g, "[^/]+")}/?$`),
}));

export function isAdminRoute(method: string, path: string): boolean {
  return ADMIN_MATCHERS.some((matcher) => matcher.method === method && matcher.pattern.test(path));
}

function sameSecret(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createTransportAuth(options: {
  serviceToken: string;
  ownerId: string;
}): express.RequestHandler {
  const serviceToken = options.serviceToken.trim();
  const ownerId = options.ownerId.trim();
  return (req, res, next) => {
    if (UNAUTHENTICATED_PATHS.has(req.path)) return next();
    const presented = req.get(BOT_SERVICE_HEADER)?.trim() ?? "";
    if (!serviceToken || !presented || !sameSecret(presented, serviceToken)) {
      res.status(401).json({ error: "Unauthorized", code: "transport_unauthenticated" });
      return;
    }
    if (isAdminRoute(req.method, req.path)) {
      const actor = req.get(ACTOR_HEADER)?.trim() ?? "";
      if (!ownerId || actor !== ownerId) {
        res.status(403).json({ error: "Forbidden", code: "admin_requires_owner" });
        return;
      }
    }
    next();
  };
}
