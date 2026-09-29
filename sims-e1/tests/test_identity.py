import os
import sys
import types
import unittest

if "services" not in sys.modules:
    sys.modules["services"] = types.ModuleType("services")


SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
if SRC not in sys.path:
    sys.path.insert(0, SRC)
if "ashley_e1" not in sys.modules:
    package = types.ModuleType("ashley_e1")
    package.__path__ = [os.path.join(SRC, "ashley_e1")]
    sys.modules["ashley_e1"] = package

from ashley_e1 import snapshot
from ashley_e1 import observers


class InteractionIdentityTests(unittest.TestCase):
    def test_entry_key_distinguishes_same_metadata_instances(self):
        first = object()
        second = object()
        self.assertNotEqual(snapshot.entry_key(first), snapshot.entry_key(second))
        self.assertTrue(snapshot.entry_key(first).startswith("0x"))

    def test_queue_and_running_same_object_are_deduplicated(self):
        shared = object()
        queued_only = object()
        running_only = object()
        rows, queue_truncated, running_truncated = snapshot.merge_interactions(
            [shared, queued_only], [shared, running_only], snapshot.minimal_interaction
        )
        by_key = {row["entry_key"]: row for row in rows}
        self.assertEqual(len(rows), 3)
        self.assertEqual(by_key[snapshot.entry_key(shared)]["membership"], "QUEUED_AND_RUNNING")
        self.assertEqual(by_key[snapshot.entry_key(queued_only)]["membership"], "QUEUED")
        self.assertEqual(by_key[snapshot.entry_key(running_only)]["membership"], "RUNNING")
        self.assertFalse(queue_truncated)
        self.assertFalse(running_truncated)

    def test_caps_mark_observation_incomplete(self):
        rows, queue_truncated, running_truncated = snapshot.merge_interactions(
            [object() for _ in range(9)], [], snapshot.minimal_interaction
        )
        self.assertEqual(len(rows), 8)
        self.assertTrue(queue_truncated)
        self.assertFalse(running_truncated)
        self.assertFalse(snapshot.interactions_complete(queue_truncated, running_truncated, False))

    def test_interaction_collection_stops_after_cap(self):
        class ExplodingTail:
            def __iter__(self):
                for index in range(8):
                    yield object()
                raise AssertionError("iterator consumed beyond the observation cap")

        rows, queue_truncated, running_truncated = snapshot.merge_interactions(
            ExplodingTail(), [], snapshot.minimal_interaction
        )
        self.assertEqual(len(rows), 8)
        self.assertTrue(queue_truncated)
        self.assertFalse(running_truncated)

    def test_appear_requires_adjacent_complete_same_session(self):
        old = {"telemetry_session_id": "s1", "observation_complete": True,
               "interactions": {"observation_complete": True, "observed": []}}
        current = {"telemetry_session_id": "s1", "observation_complete": True,
                   "interactions": {"observation_complete": True,
                                    "observed": [{"entry_key": "0xa", "present": True}]}}
        self.assertEqual(snapshot.appeared_entry_keys(old, current), ["0xa"])
        for damaged in (
            None,
            {"telemetry_session_id": "s1", "observation_complete": False,
             "interactions": {"observation_complete": False, "observed": []}},
            {"telemetry_session_id": "s2", "observation_complete": True,
             "interactions": {"observation_complete": True, "observed": []}},
        ):
            self.assertEqual(snapshot.appeared_entry_keys(damaged, current), [])

    def test_freeze_rejects_live_objects(self):
        self.assertEqual(snapshot.freeze_plain({"x": [1, False, None, "ok"]}),
                         {"x": [1, False, None, "ok"]})
        with self.assertRaises(TypeError):
            snapshot.freeze_plain({"live": object()})


class _SimInfo:
    def __init__(self, selectable=True, instance=None):
        self.is_selectable = selectable
        self._instance = object() if instance is None else instance

    def get_sim_instance(self, allow_hidden_flags=None):
        return self._instance


class BodySelectionTests(unittest.TestCase):
    def test_one_true_selectable_is_selected(self):
        chosen, sim = observers.select_lab_body([_SimInfo(False), _SimInfo(True)], object())
        self.assertIs(chosen.is_selectable, True)
        self.assertIsNotNone(sim)

    def test_zero_and_multiple_are_ambiguous(self):
        with self.assertRaises(observers.LabIdentityAmbiguous) as zero:
            observers.select_lab_body([_SimInfo(False)], object())
        self.assertEqual(zero.exception.eligible_count, 0)
        with self.assertRaises(observers.LabIdentityAmbiguous) as many:
            observers.select_lab_body([_SimInfo(True), _SimInfo(True)], object())
        self.assertEqual(many.exception.eligible_count, 2)

    def test_selectability_read_failures_are_fail_closed(self):
        class Missing:
            def get_sim_instance(self, allow_hidden_flags=None):
                return object()

        class Raises:
            def get_sim_instance(self, allow_hidden_flags=None):
                return object()

            @property
            def is_selectable(self):
                raise RuntimeError("unreadable")

        for candidate in (Missing(), Raises(), _SimInfo(None), _SimInfo(1),
                          _SimInfo("yes"), _SimInfo(object())):
            with self.subTest(candidate=candidate):
                with self.assertRaises(observers.SelectabilityReadFailure):
                    observers.select_lab_body([candidate], object())

    def test_uninstantiated_candidates_are_ineligible(self):
        candidate = _SimInfo(True, instance=False)
        candidate._instance = None
        with self.assertRaises(observers.LabIdentityAmbiguous) as error:
            observers.select_lab_body([candidate], object())
        self.assertEqual(error.exception.eligible_count, 0)

    def test_admission_source_has_no_coercion_or_fallback(self):
        path = os.path.join(SRC, "ashley_e1", "observers.py")
        with open(path, "r", encoding="utf-8") as handle:
            source = handle.read()
        self.assertIn("selectable = si.is_selectable", source)
        self.assertIn("type(selectable) is not bool", source)
        self.assertNotIn("bool(selectable)", source)
        self.assertNotIn("active_sim", source)
        self.assertNotIn("getattr(", source)


if __name__ == "__main__":
    unittest.main()
