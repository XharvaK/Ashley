import json
import os
import sys
import types
import unittest


SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
if SRC not in sys.path:
    sys.path.insert(0, SRC)
if "ashley_e1" not in sys.modules:
    package = types.ModuleType("ashley_e1")
    package.__path__ = [os.path.join(SRC, "ashley_e1")]
    sys.modules["ashley_e1"] = package

from ashley_e1 import schema


class SchemaContractTests(unittest.TestCase):
    def test_closed_vocabularies_are_exact(self):
        self.assertEqual(schema.OBSERVATION_SCHEMA_VERSION, 1)
        self.assertEqual(schema.TELEMETRY_SCHEMA_ID, "e1.telemetry/v1")
        self.assertEqual(
            set(schema.EVENT_KINDS),
            {
                "session_open",
                "session_checkpoint",
                "session_close",
                "zone_snapshot",
                "presence_snapshot",
                "clock_snapshot",
                "save_observation",
                "guard_exhausted",
                "dropped_summary",
                "load_disabled",
                "cap_reached",
                "writer_failed",
            },
        )
        self.assertEqual(
            set(schema.MISSINGNESS_STATUSES),
            {"MISSING", "ABSENT", "UNSUPPORTED", "UNKNOWN"},
        )

    def test_load_disabled_is_minimal_and_valid(self):
        row = schema.make_load_disabled_record(
            boot_id="00000000-0000-4000-8000-000000000001",
            wall_timestamp_ms=12,
            monotonic_ns=34,
            runtime={"python_version": "3.7.0", "perf_counter": True},
        )
        schema.validate_record(row)
        self.assertIsNone(row["telemetry_session_id"])
        self.assertEqual(row["attestation"]["armed_name"], "UNARMED")
        for forbidden in ("save", "zone", "body", "interactions", "motives", "sim_signals"):
            self.assertNotIn(forbidden, row)

    def test_presence_payload_and_large_ids_are_lossless(self):
        huge = "18446744073709551615"
        row = schema.make_record(
            "presence_snapshot",
            telemetry_session_id="00000000-0000-4000-8000-000000000002",
            wall_timestamp_ms=100,
            monotonic_ns=200,
            observation_complete=True,
            attestation=schema.attestation("LAB_E1", "abcd1234", huge, "3", huge),
            save={"save_slot_guid": huge, "slot_id": "3"},
            zone={"zone_id": "1", "lot_id": "2", "room": None, "position": None},
            body={"sim_id": huge, "instantiated": True, "is_selectable": True,
                  "is_selected": None, "posture": None},
            interactions={"observed": [], "queue_truncated": False,
                          "running_truncated": False, "observation_complete": True},
        )
        schema.validate_record(row)
        decoded = json.loads(schema.serialize_record(row).decode("utf-8"))
        self.assertEqual(decoded["body"]["sim_id"], huge)
        self.assertIsInstance(decoded["body"]["sim_id"], str)

    def test_unknown_event_and_noncanonical_missingness_fail(self):
        row = schema.make_record(
            "clock_snapshot",
            telemetry_session_id="00000000-0000-4000-8000-000000000003",
            wall_timestamp_ms=1,
            monotonic_ns=2,
            game={"ticks": 0, "calendar": None, "clock_speed": "NORMAL", "paused": False},
        )
        row["event_kind"] = "interaction_event"
        with self.assertRaises(schema.SchemaError):
            schema.validate_record(row)
        row["event_kind"] = "clock_snapshot"
        row["missingness"] = {"save.slot": {"status": "UNEXPOSED", "detail": None}}
        with self.assertRaises(schema.SchemaError):
            schema.validate_record(row)

    def test_false_and_zero_are_not_treated_as_missing(self):
        row = schema.make_record(
            "clock_snapshot",
            telemetry_session_id="00000000-0000-4000-8000-000000000004",
            wall_timestamp_ms=0,
            monotonic_ns=0,
            game={"ticks": 0, "calendar": "0", "clock_speed": "PAUSED", "paused": False},
        )
        schema.validate_record(row)

    def test_non_observation_events_reject_substantive_payloads(self):
        row = schema.make_record(
            "dropped_summary", telemetry_session_id="00000000-0000-4000-8000-000000000005",
            wall_timestamp_ms=1, monotonic_ns=2, reason="QUEUE_SATURATION",
            save={"save_slot_guid": "unexpected", "slot_id": "slot"},
        )
        with self.assertRaises(schema.SchemaError):
            schema.validate_record(row)

    def test_motive_and_signal_shapes_are_closed(self):
        row = schema.make_record(
            "presence_snapshot", telemetry_session_id="00000000-0000-4000-8000-000000000006",
            wall_timestamp_ms=1, monotonic_ns=2, observation_complete=True,
            attestation=schema.attestation("LAB_E1"),
            save={"save_slot_guid": "g", "slot_id": "s"},
            body={"sim_id": "sim", "instantiated": True, "is_selectable": True,
                  "is_selected": None, "posture": None},
            interactions={"observed": [], "queue_truncated": False,
                          "running_truncated": False, "observation_complete": True},
            motives=[{"id": "m", "value": 1, "band": None}],
            sim_signals=[{"kind": "MOODLET", "tuning_id": "t", "game_text": None,
                          "magnitude": None, "consequences": "UNKNOWN", "native_override": None}],
        )
        schema.validate_record(row)
        row["sim_signals"][0]["kind"] = "NOT_CLOSED"
        with self.assertRaises(schema.SchemaError):
            schema.validate_record(row)


if __name__ == "__main__":
    unittest.main()
