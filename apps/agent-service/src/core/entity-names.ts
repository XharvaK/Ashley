/** N0.2: the entity's and its owner's names, from configuration; read at call time so the env file has loaded. */
export function entityName(): string {
  return process.env.ASHLEY_ENTITY_NAME?.trim() || "Ashley";
}

export function ownerName(): string {
  return process.env.ASHLEY_OWNER_NAME?.trim() || "Alex";
}

export function deliveryChannels(): string {
  return process.env.ASHLEY_CHANNELS?.trim() || "Discord";
}
