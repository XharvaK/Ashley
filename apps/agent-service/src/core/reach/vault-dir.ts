import { join } from "node:path";

/** I1: where her vault lives on her computer (files 0600; values never printed, logged or shown to her). */
export function vaultDirFor(dataDir: string): string {
  return join(dataDir, "vault");
}
