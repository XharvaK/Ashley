/**
 * Some unit tests validate pre-network provider behavior or replace the
 * dispatcher entirely. Keep those assertions meaningful in the full offline
 * suite while leaving the process-wide transport guard installed.
 */
export async function withOfflineAppGateDisabled<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const saved = process.env.ASHLEY_PHASE0_OFFLINE;
  delete process.env.ASHLEY_PHASE0_OFFLINE;
  try {
    return await operation();
  } finally {
    if (saved === undefined) delete process.env.ASHLEY_PHASE0_OFFLINE;
    else process.env.ASHLEY_PHASE0_OFFLINE = saved;
  }
}
