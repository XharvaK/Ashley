import json
import os
import sys
import tempfile
import time
import types
import unittest


SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
if SRC not in sys.path:
    sys.path.insert(0, SRC)
if "ashley_e1" not in sys.modules:
    package = types.ModuleType("ashley_e1")
    package.__path__ = [os.path.join(SRC, "ashley_e1")]
    sys.modules["ashley_e1"] = package

from ashley_e1 import schema, writer


def clock_row(index=0):
    return schema.make_record(
        "clock_snapshot", telemetry_session_id="session-a",
        wall_timestamp_ms=index, monotonic_ns=index,
        game={"ticks": index, "calendar": None, "clock_speed": "NORMAL", "paused": False},
    )


def presence_row(index=0):
    return schema.make_record(
        "presence_snapshot", telemetry_session_id="session-a",
        wall_timestamp_ms=index, monotonic_ns=index, observation_complete=True,
        attestation=schema.attestation("LAB_E1", "12345678", "1", "2", "3"),
        save={"save_slot_guid": "1", "slot_id": "2"},
        zone={"zone_id": "4", "lot_id": "5", "room": None, "position": None},
        body={"sim_id": "3", "instantiated": True, "is_selectable": True,
              "is_selected": None, "posture": None},
        interactions={"observed": [], "queue_truncated": False,
                      "running_truncated": False, "observation_complete": True},
    )


class WriterBoundTests(unittest.TestCase):
    def test_contract_caps(self):
        self.assertEqual(writer.QUEUE_CAPACITY, 1024)
        self.assertEqual(writer.MAX_ACTIVE_FILE_BYTES, 8 * 1024 * 1024)
        self.assertEqual(writer.MAX_ROTATED_SIBLINGS_PER_SESSION, 4)
        self.assertEqual(writer.MAX_TELEMETRY_DIR_BYTES, 200 * 1024 * 1024)
        self.assertEqual(schema.MAX_SERIALIZED_RECORD_BYTES, 8 * 1024)

    def test_full_queue_evicts_clock_before_critical(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(temp, "session-a", "1.0.0", "1.128.90.1030",
                                          queue_capacity=2, autostart=False)
            self.assertTrue(sink.try_put(presence_row(1)))
            self.assertTrue(sink.try_put(clock_row(2)))
            self.assertTrue(sink.try_put(presence_row(3)))
            self.assertEqual(sink.queued_event_kinds(), ["presence_snapshot", "presence_snapshot"])
            self.assertEqual(sink.counters["dropped_queue"], 1)
            self.assertFalse(sink.capture_stopped)

    def test_all_critical_saturation_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(temp, "session-a", "1.0.0", "1.128.90.1030",
                                          queue_capacity=1, autostart=False)
            self.assertTrue(sink.try_put(presence_row(1)))
            self.assertFalse(sink.try_put(presence_row(2)))
            self.assertTrue(sink.capture_stopped)
            self.assertEqual(sink.failure_reason, "saturation_critical")

    def test_rotation_continues_sequence_and_emits_checkpoint(self):
        with tempfile.TemporaryDirectory() as temp:
            sample_size = len(schema.serialize_record(clock_row(1))) + 1
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030",
                max_file_bytes=(sample_size * 2) + 20, max_rotations=2,
                max_dir_bytes=1024 * 1024,
            )
            for index in range(5):
                self.assertTrue(sink.try_put(clock_row(index)))
            sink.signal_close("DISARM_CLEAN")
            self.assertTrue(sink.wait_idle(5.0))
            paths = sink.output_paths
            self.assertGreaterEqual(len(paths), 2)
            rows = []
            for path in paths:
                with open(path, "r", encoding="utf-8") as handle:
                    rows.extend(json.loads(line) for line in handle if line.strip())
            self.assertEqual([row["written_sequence"] for row in rows], list(range(len(rows))))
            self.assertTrue(any(row["event_kind"] == "session_checkpoint" and
                                row["checkpoint_reason"] == "ROTATION" for row in rows))

    def test_directory_cap_stops_without_deleting_existing_data(self):
        with tempfile.TemporaryDirectory() as temp:
            existing = os.path.join(temp, "owner-evidence.jsonl")
            with open(existing, "wb") as handle:
                handle.write(b"x" * 200)
            sink = writer.TelemetryWriter(temp, "session-a", "1.0.0", "1.128.90.1030",
                                          max_dir_bytes=220)
            sink.try_put(clock_row(1))
            sink.signal_close("DISARM_CLEAN")
            self.assertTrue(sink.wait_idle(5.0))
            self.assertEqual(sink.state, "CAP_REACHED")
            self.assertTrue(os.path.exists(existing))
            self.assertEqual(os.path.getsize(existing), 200)

    def test_write_failure_is_sticky_and_does_not_recurse(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(temp, "session-a", "1.0.0", "1.128.90.1030",
                                          autostart=False)
            sink._open_active = lambda: (_ for _ in ()).throw(OSError("injected"))
            self.assertTrue(sink.try_put(clock_row(1)))
            sink.start()
            sink.signal_close("DISARM_CLEAN")
            self.assertTrue(sink.wait_idle(5.0))
            self.assertEqual(sink.state, "FAILED_STICKY")
            self.assertEqual(sink.failure_reason, "write_failure")

    def test_tiny_active_cap_never_writes_past_configured_limit(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(temp, "session-a", "1.0.0", "1.128.90.1030",
                                          max_file_bytes=100, max_rotations=1,
                                          max_dir_bytes=10 * 1024)
            self.assertTrue(sink.try_put(clock_row(1)))
            sink.signal_close("DISARM_CLEAN")
            self.assertTrue(sink.wait_idle(5.0))
            self.assertEqual(sink.state, "CAP_REACHED")
            self.assertTrue(all(os.path.getsize(path) <= 100 for path in sink.output_paths))


if __name__ == "__main__":
    unittest.main()
