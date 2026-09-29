"""Pure E2 handle registry: claim ladder over plain-data presence rows.

No game imports and no I/O (plan E2 §8.3). Claims are separate facts and are
never collapsed; anything not proven stays OUTCOME_UNKNOWN. Polling absence
never becomes FINISHED; only the game's finishing callback sets FINISHED.
"""

from . import e2_admission

WINDOW_SECONDS = 60.0
MAINTAIN_SECONDS = 10.0
SIGNATURE_WINDOW_SECONDS = 30.0
RUNNING_MEMBERSHIPS = ("RUNNING", "QUEUED_AND_RUNNING")
CLAIM_ORDER = ("REQUEST_ACCEPTED", "ENQUEUED", "STARTED", "EFFECT_OBSERVED",
               "ATTRIBUTED", "MAINTAINED_10S", "FINISHED")

PASS = "PASS"
OUTCOME_UNKNOWN = "OUTCOME_UNKNOWN"


def _entries(row):
    return (row.get("interactions") or {}).get("observed") or []


def _posture(row):
    return ((row.get("body") or {}).get("posture")) or {}


class Experiment:
    def __init__(self, experiment_id, token, object_id, sim_id, interaction_id,
                 pushed_mono_ns, signature, baseline_ids):
        self.experiment_id = experiment_id
        self.token = token
        self.object_id = object_id
        self.sim_id = sim_id
        self.interaction_id = interaction_id
        self.pushed_mono_ns = pushed_mono_ns
        self.signature = signature
        self.known_ids = set(i for i in baseline_ids if i is not None)
        self.claims = dict((key, False) for key in CLAIM_ORDER)
        self.claims["REQUEST_ACCEPTED"] = True
        self.foreign_roots = []
        self.incomplete_rows = 0
        self.started_ns = None
        self.effect_since_ns = None
        self.attributed_ns = None
        self.maintenance_broken = False
        self.finishing_type = None
        self.closed = False
        self.verdict = None

    def observe(self, row):
        """Advance claims from one presence row; returns newly set claim names."""
        if self.closed:
            return []
        before = dict(self.claims)
        mono = row.get("monotonic_ns")
        if row.get("observation_complete") is not True:
            self.incomplete_rows += 1
        ours = None
        for entry in _entries(row):
            iid = entry.get("interaction_id")
            if iid is not None and iid == self.interaction_id:
                ours = entry
                continue
            if iid is None or iid in self.known_ids:
                continue
            self.known_ids.add(iid)
            source = entry.get("source_raw")
            if (source in e2_admission.BUSY_SOURCES or
                    (source == "InteractionSource.AUTONOMY" and
                     entry.get("target_id") == self.object_id)):
                self.foreign_roots.append(iid)
        if ours is not None:
            self.claims["ENQUEUED"] = True
            if ours.get("membership") in RUNNING_MEMBERSHIPS and self.started_ns is None:
                self.started_ns = mono
                self.claims["STARTED"] = True
        posture = _posture(row)
        seated = (posture.get("target_id") == self.object_id and
                  self.signature is not None and
                  posture.get("posture_name") == self.signature)
        if seated:
            self.claims["EFFECT_OBSERVED"] = True
            if self.effect_since_ns is None:
                self.effect_since_ns = mono
        else:
            self.effect_since_ns = None
            if self.claims["ATTRIBUTED"] and not self.claims["MAINTAINED_10S"]:
                # Maintenance must be continuous from attribution; a later
                # re-seat is a new, unattributed effect.
                self.maintenance_broken = True
        if (seated and self.claims["STARTED"] and not self.claims["ATTRIBUTED"] and
                not self.foreign_roots and self.incomplete_rows == 0 and
                self.started_ns is not None and self.started_ns <= mono):
            self.claims["ATTRIBUTED"] = True
            self.attributed_ns = mono
        if (self.claims["ATTRIBUTED"] and seated and not self.foreign_roots and
                not self.maintenance_broken and
                self.effect_since_ns is not None and
                mono - max(self.effect_since_ns, self.attributed_ns) >=
                MAINTAIN_SECONDS * 1e9):
            self.claims["MAINTAINED_10S"] = True
        if mono - self.pushed_mono_ns >= WINDOW_SECONDS * 1e9:
            self.close()
        return [key for key in CLAIM_ORDER if self.claims[key] and not before[key]]

    def finish(self, finishing_type):
        if self.finishing_type is None:
            self.finishing_type = finishing_type
        self.claims["FINISHED"] = True

    def close(self):
        if self.closed:
            return self.verdict
        self.closed = True
        if self.claims["ATTRIBUTED"] and self.claims["MAINTAINED_10S"]:
            self.verdict = PASS
        else:
            self.verdict = OUTCOME_UNKNOWN
        return self.verdict


class SignatureLearner:
    """Learn the seated posture name from an Owner pie-menu sit on the object.

    The Host never guesses which posture name means "seated": the name is
    taken from what the game reports after the Owner's own Sit click (N5).
    """

    def __init__(self):
        self.signatures = {}
        self._pending = {}

    def observe(self, row, open_harness_ids):
        """Returns (object_id, posture_name) when a signature is learned."""
        mono = row.get("monotonic_ns")
        if row.get("observation_complete") is not True:
            return None
        for entry in _entries(row):
            if (entry.get("source_raw") == "InteractionSource.PIE_MENU" and
                    entry.get("affordance_id") == e2_admission.SIT_AFFORDANCE_GUID and
                    entry.get("target_id") is not None and
                    entry.get("interaction_id") not in open_harness_ids):
                self._pending.setdefault(entry["target_id"], mono)
        posture = _posture(row)
        target = posture.get("target_id")
        name = posture.get("posture_name")
        for object_id, since in list(self._pending.items()):
            if mono - since > SIGNATURE_WINDOW_SECONDS * 1e9:
                self._pending.pop(object_id)
                continue
            if target == object_id and name is not None and object_id not in self.signatures:
                self.signatures[object_id] = name
                self._pending.pop(object_id)
                return object_id, name
        return None
