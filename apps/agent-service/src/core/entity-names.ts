/** N0.2: the entity's and its owner's names, from configuration; read at call time so the env file has loaded. */
export function entityName(): string {
  return process.env.ASHLEY_ENTITY_NAME?.trim() || "Ashley";
}

export function ownerName(): string {
  return process.env.ASHLEY_OWNER_NAME?.trim() || "Alex";
}

/** Other names the owner goes by in her older records (comma-separated); private like the name itself. */
export function ownerAliases(): string {
  return process.env.ASHLEY_OWNER_ALIASES?.trim() || "Doc";
}

export function deliveryChannels(): string {
  return process.env.ASHLEY_CHANNELS?.trim() || "Discord";
}
