// Shared capture array for the runAttentiveDispatch mock used by Track M tests.
export const dispatchCalls: Array<{
  routeAlias: string | null;
  purpose: string;
  lane: string;
  providerId: string;
}> = [];
