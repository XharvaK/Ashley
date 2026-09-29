"""Pure E2 admission: prepare checks, single-use tokens, stale detection.

No game imports and no I/O. The probe builds a plain-data admission view on
the game thread and passes it here (plan E2 §8.2).
"""

import uuid

from . import e2_lineage

SIT_AFFORDANCE_GUID = "31564"
TOKEN_TTL_SECONDS = 30.0
MAX_OPEN_TOKENS = 8

BUSY_SOURCES = (
    "InteractionSource.PIE_MENU",
    "InteractionSource.SCRIPT",
    "InteractionSource.SCRIPT_WITH_USER_INTENT",
    "InteractionSource.REACTION",
)

# Rejection codes (closed set; printed to the Owner and written to telemetry).
NOT_SAMPLING = "NOT_SAMPLING"
LINEAGE_PENDING = "LINEAGE_PENDING"
LINEAGE_NOT_ADMISSIBLE = "LINEAGE_NOT_ADMISSIBLE"
BODY_MISMATCH = "BODY_MISMATCH"
BODY_UNAVAILABLE = "BODY_UNAVAILABLE"
NO_OBJECT = "NO_OBJECT"
AFFORDANCE_NOT_OFFERED = "AFFORDANCE_NOT_OFFERED"
OBJECT_EXCLUDED = "OBJECT_EXCLUDED"
SIGNATURE_UNKNOWN = "SIGNATURE_UNKNOWN"
PRECONDITION_PRESENT = "PRECONDITION_PRESENT"
BODY_BUSY = "BODY_BUSY"
CLOCK_PAUSED = "CLOCK_PAUSED"
TOKEN_UNKNOWN = "TOKEN_UNKNOWN"
TOKEN_EXPIRED = "TOKEN_EXPIRED"
REPLAY_REJECTED = "REPLAY_REJECTED"
STALE_SNAPSHOT = "STALE_SNAPSHOT"
TOO_MANY_TOKENS = "TOO_MANY_TOKENS"
BAD_ARGUMENT = "BAD_ARGUMENT"


def check(view, object_id, excluded_ids, signatures, own_open_ids):
    """Return None when admissible, else one rejection code."""
    if view.get("sampling") is not True:
        return NOT_SAMPLING
    lineage_class = view.get("lineage_class")
    if lineage_class in (None, e2_lineage.PENDING):
        return LINEAGE_PENDING
    if lineage_class == e2_lineage.BODY_MISMATCH:
        return BODY_MISMATCH
    if not e2_lineage.is_admissible(lineage_class):
        return LINEAGE_NOT_ADMISSIBLE
    designated = view.get("designated_sim_id")
    if designated is not None and designated != view.get("sim_id"):
        return BODY_MISMATCH
    if view.get("sim_id") is None or view.get("body_available") is not True:
        return BODY_UNAVAILABLE
    obj = view.get("object") or {}
    if obj.get("exists") is not True:
        return NO_OBJECT
    if object_id in excluded_ids:
        return OBJECT_EXCLUDED
    if obj.get("sit_offer_count") != 1:
        return AFFORDANCE_NOT_OFFERED
    if object_id not in signatures:
        return SIGNATURE_UNKNOWN
    if view.get("posture_target_id") == object_id:
        return PRECONDITION_PRESENT
    for entry in view.get("entries", ()):
        if entry.get("interaction_id") in own_open_ids:
            return BODY_BUSY
        if entry.get("source_raw") in BUSY_SOURCES:
            return BODY_BUSY
    if view.get("paused") is not False:
        return CLOCK_PAUSED
    return None


def fingerprint(view):
    """Facts that must not change between prepare and admit (ticks excluded)."""
    busy = sorted(
        (entry.get("interaction_id") or "", entry.get("source_raw") or "")
        for entry in view.get("entries", ())
        if entry.get("source_raw") in BUSY_SOURCES)
    obj = view.get("object") or {}
    return (view.get("guid"), view.get("slot_id"), view.get("sim_id"),
            view.get("lineage_class"), view.get("posture_target_id"),
            obj.get("exists"), obj.get("sit_offer_count"), tuple(busy))


class TokenBook:
    """Single-use, expiring admission tokens bound to a prepare snapshot."""

    def __init__(self, token_factory=None):
        self._open = {}
        self._spent = set()
        self._expired = set()
        self._factory = token_factory or (lambda: uuid.uuid4().hex[:16])

    def issue(self, object_id, view, now):
        self._expire(now)
        if len(self._open) >= MAX_OPEN_TOKENS:
            return None, TOO_MANY_TOKENS
        token = self._factory()
        self._open[token] = {"object_id": object_id, "fingerprint": fingerprint(view),
                             "issued": now}
        return token, None

    def consume(self, token, now):
        if token in self._expired:
            self._expired.discard(token)
            self._spent.add(token)
            return None, TOKEN_EXPIRED
        if token in self._spent:
            return None, REPLAY_REJECTED
        bound = self._open.pop(token, None)
        if bound is None:
            return None, TOKEN_UNKNOWN
        self._spent.add(token)
        if now - bound["issued"] > TOKEN_TTL_SECONDS:
            return None, TOKEN_EXPIRED
        return bound, None

    def clear(self):
        self._open.clear()

    def _expire(self, now):
        for token in [t for t, b in self._open.items()
                      if now - b["issued"] > TOKEN_TTL_SECONDS]:
            self._open.pop(token)
            self._expired.add(token)


def admit(bound, fresh_view, object_id, excluded_ids, signatures, own_open_ids):
    """Re-run the checks against a fresh read and require an unchanged fingerprint."""
    if bound["object_id"] != object_id:
        return BAD_ARGUMENT
    code = check(fresh_view, object_id, excluded_ids, signatures, own_open_ids)
    if code is not None:
        return STALE_SNAPSHOT if code in (PRECONDITION_PRESENT, BODY_BUSY) else code
    if fingerprint(fresh_view) != bound["fingerprint"]:
        return STALE_SNAPSHOT
    return None
