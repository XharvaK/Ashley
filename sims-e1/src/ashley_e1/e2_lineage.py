"""Pure E2 world-lineage classification over an outside-save ledger.

No game imports and no file I/O: the writer thread loads and appends the
ledger; this module only interprets plain-data records (plan E2 §6).
"""

CONTINUES_LAST_SAVE = "CONTINUES_LAST_SAVE"
ROLLBACK = "ROLLBACK"
UNOBSERVED_SAVE = "UNOBSERVED_SAVE"
FORK = "FORK"
LINEAGE_TRANSFER = "LINEAGE_TRANSFER"
FOREIGN_OR_UNKNOWN = "FOREIGN_OR_UNKNOWN"
BODY_MISMATCH = "BODY_MISMATCH"
PENDING = "PENDING"

ADMISSIBLE_CLASSES = (CONTINUES_LAST_SAVE, FORK)


def _saves_into(records, guid, slot_id):
    return [r for r in records
            if r.get("record") == "SAVE_OBSERVED" and r.get("guid") == guid and
            r.get("slot_id") == slot_id]


def designated_body(records, guid):
    """Last DESIGNATED_BODY record for this guid, or None."""
    found = None
    for record in records:
        if record.get("record") == "DESIGNATED_BODY" and record.get("guid") == guid:
            found = record
    return found


def classify(records, guid, slot_id, sim_id, ticks, epsilon=0):
    """Classify a freshly loaded world against the ledger (plan E2 §6.3)."""
    if guid is None or slot_id is None or sim_id is None or ticks is None:
        return FOREIGN_OR_UNKNOWN
    body = designated_body(records, guid)
    if body is not None and body.get("sim_id") != sim_id:
        return BODY_MISMATCH
    saves = _saves_into(records, guid, slot_id)
    if saves:
        last = saves[-1]
        loaded_from = last.get("loaded_from_slot_id")
        if (loaded_from is not None and loaded_from != slot_id and
                _ticks_match(last, ticks, epsilon)):
            # The newest save into this slot came from a session that had
            # loaded another slot: a Save-As into a fresh slot is a FORK; into a
            # slot with earlier history it overwrote that history.
            return FORK if len(saves) == 1 else LINEAGE_TRANSFER
        saved_ticks = last.get("ticks")
        if saved_ticks is None:
            return FOREIGN_OR_UNKNOWN
        if ticks < saved_ticks - epsilon:
            return ROLLBACK
        if ticks > saved_ticks + epsilon:
            return UNOBSERVED_SAVE
        return CONTINUES_LAST_SAVE
    return FOREIGN_OR_UNKNOWN


def _ticks_match(record, ticks, epsilon):
    saved = record.get("ticks")
    return saved is not None and abs(ticks - saved) <= epsilon


def reclassify_after_save(current_class):
    """An armed Owner save captured the live state: the session now continues it."""
    if current_class == BODY_MISMATCH:
        return BODY_MISMATCH
    return CONTINUES_LAST_SAVE


def is_admissible(lineage_class):
    return lineage_class in ADMISSIBLE_CLASSES
