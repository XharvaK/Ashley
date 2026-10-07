/** Mirrors apps/agent-service/src/core/entity-names.ts. */
export function entityName(): string {
  return process.env.ASHLEY_ENTITY_NAME?.trim() || "Ashley";
}

export function ownerName(): string {
  return process.env.ASHLEY_OWNER_NAME?.trim() || "Alex";
}

export function deliveryChannels(): string {
  return process.env.ASHLEY_CHANNELS?.trim() || "Discord";
}
