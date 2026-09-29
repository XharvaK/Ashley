"""Game-thread snapshot helpers that return immutable plain data."""


def entry_key(entry):
    return hex(id(entry))


def minimal_interaction(entry):
    return {
        "entry_key": entry_key(entry),
        "interaction_id": None,
        "affordance_id": None,
        "affordance_text": None,
        "target_id": None,
        "source_raw": None,
        "source_norm": "UNKNOWN",
        "source_confidence": "UNKNOWN",
        "present": True,
    }


def merge_interactions(queued, running, describe):
    """Merge two bounded ordered views while retaining membership provenance."""
    queue_items, queue_truncated = _bounded_items(queued)
    running_items, running_truncated = _bounded_items(running)
    merged = {}
    order = []
    for item, membership in tuple((item, "QUEUED") for item in queue_items) + \
            tuple((item, "RUNNING") for item in running_items):
        key = entry_key(item)
        if key not in merged:
            row = dict(describe(item))
            row["entry_key"] = key
            row["membership"] = membership
            merged[key] = row
            order.append(key)
        elif merged[key]["membership"] != membership:
            merged[key]["membership"] = "QUEUED_AND_RUNNING"
    return [merged[key] for key in order], queue_truncated, running_truncated


def _bounded_items(items):
    bounded = []
    try:
        known_length = len(items)
    except (TypeError, AttributeError):
        known_length = None
    iterator = iter(items)
    while len(bounded) < 8:
        try:
            bounded.append(next(iterator))
        except StopIteration:
            break
    if known_length is None:
        # An unsized live iterator cannot prove that its eighth item is the
        # complete view without consuming an unbounded tail. Keep the sample
        # bounded and report the conservative completeness result.
        truncated = len(bounded) == 8
    else:
        truncated = known_length > 8
    return bounded, truncated


def interactions_complete(queue_truncated, running_truncated, capture_complete):
    return bool(capture_complete) and not queue_truncated and not running_truncated


def _complete_observation(observation):
    if not isinstance(observation, dict):
        return False
    interactions = observation.get("interactions")
    return (observation.get("observation_complete") is True and
            isinstance(interactions, dict) and
            interactions.get("observation_complete") is True)


def appeared_entry_keys(previous, current):
    if not _complete_observation(previous) or not _complete_observation(current):
        return []
    if previous.get("telemetry_session_id") != current.get("telemetry_session_id"):
        return []
    old = set()
    for item in previous["interactions"].get("observed", []):
        if item.get("entry_key") is not None:
            old.add(item["entry_key"])
    result = []
    for item in current["interactions"].get("observed", []):
        key = item.get("entry_key")
        if key is not None and key not in old and item.get("present") is True:
            result.append(key)
    return result


def freeze_plain(value):
    """Copy only JSON-like data so live game objects cannot cross the queue."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [freeze_plain(item) for item in value]
    if isinstance(value, tuple):
        return [freeze_plain(item) for item in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError("plain-data keys must be strings")
            result[key] = freeze_plain(item)
        return result
    raise TypeError("live object escaped snapshot copy-out")

# End of pure snapshot helpers.
