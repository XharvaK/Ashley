import { sanitizeTypography } from "../../lib/typography.js";
import { stripMetadataEcho } from "../../lib/metadata-echo.js";
import { stripMediaMarkers } from "../../lib/strip-markers.js";

/**
 * Rendering: pure function of Expression output + transport requirements.
 * Must not inspect Memory, Identity, Mind State, Decision, or Motivation.
 * May not alter lexical content except transport-required mechanical transforms.
 */
export function renderForTransport(text: string): string {
  return stripMediaMarkers(
    stripMetadataEcho(sanitizeTypography(text)),
  ).trim();
}
