import type { SocialAudience } from "../social/types.js";
import { WEB_FETCH_OPERATION_KIND } from "../../perception/web-fetch-provider.js";
import { WEB_SEARCH_OPERATION_KIND } from "../../perception/search-provider.js";

/** Every observation that reaches the public web or a site the Owner keeps. */
export function isWebOperationKind(kind: string): boolean {
  return kind === WEB_SEARCH_OPERATION_KIND || kind === WEB_FETCH_OPERATION_KIND || kind === "web.request";
}

/**
 * Web actions belong to the Owner alone. The capability list already keeps them
 * out of rooms and contact DMs; this check refuses one at dispatch even when a
 * model asks for it anyway. A missing audience is refused too.
 */
export function webAudienceRefused(kind: string, audience: SocialAudience | undefined): boolean {
  return isWebOperationKind(kind) && audience?.kind !== "owner_private";
}
