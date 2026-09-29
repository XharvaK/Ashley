import json
import os
import sys
import tempfile
import time
import types
import unittest
from unittest import mock


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


class RecordingStream:
    def __init__(self, flush_plan=None, flush_delay=0.0, fail_write=False):
        self.flush_plan = list(flush_plan or [])
        self.flush_delay = flush_delay
        self.fail_write = fail_write
        self.write_calls = []
        self.events = []
        self.flush_calls = 0
        self.closed = False

    def write(self, payload):
        if self.fail_write:
            raise OSError("injected write failure")
        self.events.append("write")
        self.write_calls.append(payload)
        return len(payload)

    def flush(self):
        self.events.append("flush")
        self.flush_calls += 1
        if self.flush_delay:
            time.sleep(self.flush_delay)
        if self.flush_plan:
            succeeds = self.flush_plan.pop(0)
            if not succeeds:
                raise OSError("injected flush failure")

    def close(self):
        self.events.append("close")
        self.closed = True


def memory_writer(temp, stream):
    sink = writer.TelemetryWriter(
        temp, "session-a", "1.0.0", "1.128.90.1030", autostart=False
    )
    sink._stream = stream
    sink._active_path = os.path.join(temp, "active.jsonl")
    sink._can_fit = lambda size: (True, True)
    return sink


def written_rows(path):
    with open(path, "r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def stream_rows(stream):
    return [json.loads(payload.rstrip(b"\n")) for payload in stream.write_calls]


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


class WriterContractRepairTests(unittest.TestCase):
    def test_initial_inventory_runs_once_and_establishes_logical_truth(self):
        with tempfile.TemporaryDirectory() as temp:
            with mock.patch.object(writer, "_directory_size",
                                   wraps=writer._directory_size) as directory_scan:
                sink = writer.TelemetryWriter(
                    temp, "session-a", "1.0.0", "1.128.90.1030",
                    autostart=False,
                )
            self.assertEqual(directory_scan.call_count, 1)
            self.assertTrue(sink._cap_truth_known)
            self.assertEqual(sink._logical_directory_bytes, 0)
            self.assertEqual(sink._logical_active_bytes, 0)

    def test_initial_inventory_failure_fails_closed_without_unknown_admission(self):
        with tempfile.TemporaryDirectory() as temp:
            with mock.patch.object(writer, "_directory_size", return_value=None):
                sink = writer.TelemetryWriter(
                    temp, "session-a", "1.0.0", "1.128.90.1030",
                    autostart=False,
                )
            self.assertEqual(sink.state, "FAILED_STICKY")
            self.assertEqual(sink.failure_reason, "inventory_failure")
            self.assertFalse(sink._cap_truth_known)
            self.assertFalse(sink.try_put(clock_row(1)))

    def test_ordinary_rows_use_logical_caps_without_directory_or_active_stat(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030", autostart=False
            )
            sink._open_active()
            with mock.patch.object(writer, "_directory_size",
                                   wraps=writer._directory_size) as directory_scan:
                with mock.patch.object(writer.os.path, "getsize",
                                       wraps=writer.os.path.getsize) as active_stat:
                    self.assertTrue(sink._write_row(presence_row(1)))
            self.assertEqual(directory_scan.call_count, 0)
            self.assertEqual(active_stat.call_count, 0)
            sink._close_stream(reconcile=False)

    def test_successful_physical_write_commits_logical_bytes_once(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030", autostart=False
            )
            sink._open_active()
            payload = b"payload"
            before_active = sink._logical_active_bytes
            before_directory = sink._logical_directory_bytes
            self.assertTrue(sink._write_physical(payload))
            size = len(payload) + 1
            self.assertEqual(sink._logical_active_bytes, before_active + size)
            self.assertEqual(sink._logical_directory_bytes, before_directory + size)
            self.assertEqual(sink._active_bytes, sink._logical_active_bytes)
            sink._close_stream(reconcile=False)

    def test_failed_physical_write_does_not_commit_logical_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030", autostart=False
            )
            sink._open_active()
            sink._stream.close()
            sink._stream = RecordingStream(fail_write=True)
            before_active = sink._logical_active_bytes
            before_directory = sink._logical_directory_bytes
            with self.assertRaises(OSError):
                sink._write_physical(b"payload")
            self.assertEqual(sink._logical_active_bytes, before_active)
            self.assertEqual(sink._logical_directory_bytes, before_directory)

    def test_uncertain_physical_write_does_not_commit_logical_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030", autostart=False
            )
            sink._open_active()
            before_active = sink._logical_active_bytes
            before_directory = sink._logical_directory_bytes
            with mock.patch.object(sink._stream, "write", return_value=1):
                with self.assertRaises(OSError):
                    sink._write_physical(b"payload")
            self.assertEqual(sink._logical_active_bytes, before_active)
            self.assertEqual(sink._logical_directory_bytes, before_directory)
            sink._close_stream(reconcile=False)

    def test_flush_boundary_reconciles_physical_directory_once(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030", autostart=False
            )
            sink._open_active()
            self.assertTrue(sink._write_physical(b"payload"))
            with mock.patch.object(writer, "_directory_size",
                                   wraps=writer._directory_size) as directory_scan:
                self.assertTrue(sink._flush_boundary(force=True))
            self.assertEqual(directory_scan.call_count, 1)
            self.assertEqual(
                sink._logical_directory_bytes,
                os.path.getsize(sink._active_path),
            )
            sink._close_stream(reconcile=False)

    def test_five_second_sampling_flush_reconciles(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030", autostart=False
            )
            sink._open_active()
            self.assertTrue(sink._write_physical(b"payload"))
            sink.set_sampling(True)
            sink._last_flush_monotonic = 10.0
            with mock.patch.object(writer.time, "perf_counter", return_value=16.0):
                with mock.patch.object(sink, "_reconcile_directory",
                                       wraps=sink._reconcile_directory) as reconcile:
                    self.assertTrue(sink._flush_if_due())
            self.assertEqual(reconcile.call_count, 1)
            sink._close_stream(reconcile=False)

    def test_checkpoint_reconciles_after_forced_flush(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030", autostart=False
            )
            sink._open_active()
            with mock.patch.object(sink, "_reconcile_directory",
                                   wraps=sink._reconcile_directory) as reconcile:
                self.assertTrue(sink._write_checkpoint("PERIODIC_60S"))
            self.assertEqual(reconcile.call_count, 1)
            sink._close_stream(reconcile=False)

    def test_buffered_bytes_are_not_double_counted_by_reconciliation(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream()
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030", autostart=False
            )
            sink._stream = stream
            sink._active_path = os.path.join(temp, "active.jsonl")
            sink._active_bytes = 0
            sink._logical_active_bytes = 0
            sink._logical_directory_bytes = 0
            payload = b"buffered"
            self.assertTrue(sink._write_physical(payload))
            expected = len(payload) + 1
            self.assertEqual(sink._logical_directory_bytes, expected)
            self.assertTrue(sink._reconcile_directory())
            self.assertEqual(sink._logical_directory_bytes, expected)
            self.assertEqual(sink._logical_active_bytes, expected)
            sink._stream.close()

    def test_external_growth_is_discovered_and_blocks_future_admission(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030",
                max_dir_bytes=256, autostart=False,
            )
            sink._open_active()
            with open(os.path.join(temp, "owner-evidence.jsonl"), "wb") as handle:
                handle.write(b"x" * 220)
            self.assertTrue(sink._reconcile_directory())
            self.assertFalse(sink._write_row(clock_row(1)))
            self.assertEqual(sink.state, "CAP_REACHED")
            self.assertTrue(os.path.exists(os.path.join(temp, "owner-evidence.jsonl")))
            sink._close_stream(reconcile=False)

    def test_rotation_reconciles_before_new_active_file(self):
        with tempfile.TemporaryDirectory() as temp:
            sample_size = len(schema.serialize_record(clock_row(1))) + 1
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030",
                max_file_bytes=(sample_size * 2) + 20, max_rotations=2,
                max_dir_bytes=1024 * 1024, autostart=False,
            )
            with mock.patch.object(sink, "_reconcile_directory",
                                   wraps=sink._reconcile_directory) as reconcile:
                self.assertTrue(sink._write_direct(clock_row(1)))
                self.assertTrue(sink._write_direct(clock_row(2)))
                sink._write_direct(clock_row(3))
            self.assertGreaterEqual(reconcile.call_count, 1)
            self.assertGreaterEqual(sink.rotation_index, 1)
            sink._close_stream(reconcile=False)

    def test_rotation_reconciliation_failure_stops_before_new_file(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030",
                max_file_bytes=1, max_rotations=2, autostart=False,
            )
            sink._open_active()
            with mock.patch.object(sink, "_reconcile_directory", return_value=False):
                self.assertFalse(sink._write_direct(clock_row(1)))
            self.assertEqual(sink.state, "FAILED_STICKY")
            self.assertEqual(sink.failure_reason, "inventory_failure")
            self.assertEqual(sink.rotation_index, 0)
            self.assertEqual(len(sink.output_paths), 1)
            sink._close_stream(reconcile=False)

    def test_close_boundary_reconciles(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030", autostart=False
            )
            sink._open_active()
            sink._close_reason = "DISARM_CLEAN"
            sink._pre_disarm_requested = True
            with mock.patch.object(sink, "_reconcile_directory",
                                   wraps=sink._reconcile_directory) as reconcile:
                sink._write_close()
                sink._close_stream()
            self.assertGreaterEqual(reconcile.call_count, 1)

    def test_ordinary_rows_do_not_flush_once_per_row(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream()
            sink = memory_writer(temp, stream)
            sink.set_sampling(True)
            sink._write_row(presence_row(1))
            sink._write_row(presence_row(2))
            self.assertEqual(stream.flush_calls, 0)
            self.assertTrue(sink._dirty)

    def test_dirty_sampling_data_flushes_at_five_second_bound(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream()
            sink = memory_writer(temp, stream)
            sink.set_sampling(True)
            sink._last_flush_monotonic = 10.0
            with mock.patch.object(writer.time, "perf_counter", return_value=16.0):
                sink._write_row(presence_row(1))
            self.assertEqual(stream.flush_calls, 1)
            self.assertFalse(sink._dirty)

    def test_checkpoint_forces_flush(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream()
            sink = memory_writer(temp, stream)
            self.assertTrue(sink._write_checkpoint("PERIODIC_60S"))
            self.assertEqual(stream.flush_calls, 1)

    def test_every_checkpoint_reason_forces_flush(self):
        for reason in ("PERIODIC_60S", "ROTATION", "PRE_DISARM"):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as temp:
                stream = RecordingStream()
                sink = memory_writer(temp, stream)
                self.assertTrue(sink._write_checkpoint(reason))
                self.assertEqual(stream.flush_calls, 1)

    def test_cap_diagnostic_flushes_buffered_rows(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream()
            sink = memory_writer(temp, stream)
            sink._write_physical(b"buffered")
            sink.max_rotations = 0
            sink._can_fit = lambda size: (True, False)
            self.assertFalse(sink._write_row(presence_row(1)))
            self.assertEqual(sink.state, "CAP_REACHED")
            self.assertGreaterEqual(stream.flush_calls, 1)

    def test_signal_close_is_signal_only_and_writer_flushes_on_writer_thread(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream()
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030", autostart=False
            )

            def open_fake():
                sink._active_path = os.path.join(temp, "fake.jsonl")
                sink._stream = stream
                sink._active_bytes = 0
                sink.output_paths.append(sink._active_path)

            sink._open_active = open_fake
            sink._can_fit = lambda size: (True, True)
            sink.start()
            self.assertTrue(sink.try_put(presence_row(1)))
            deadline = time.time() + 2.0
            while sink._sequence == 0 and time.time() < deadline:
                time.sleep(0.01)
            self.assertEqual(sink._sequence, 1)
            sink.signal_close("DISARM_CLEAN")
            self.assertEqual(stream.flush_calls, 0)
            self.assertTrue(sink.wait_idle(5.0))
            self.assertGreaterEqual(stream.flush_calls, 1)
            self.assertTrue(stream.closed)

    def test_final_close_forces_flush_before_stream_close(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream()
            sink = memory_writer(temp, stream)
            sink._close_reason = "DISARM_CLEAN"
            sink._write_close()
            self.assertGreaterEqual(stream.flush_calls, 1)
            sink._close_stream()
            self.assertTrue(stream.closed)
            self.assertLess(stream.events.index("write"),
                            stream.events.index("flush"))
            self.assertEqual(stream.events[-1], "close")

    def test_writer_failure_diagnostic_attempts_flush(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream()
            sink = memory_writer(temp, stream)
            sink._mark_failure("FAILED_STICKY", "test_failure")
            self.assertGreaterEqual(stream.flush_calls, 1)
            self.assertTrue(sink._diagnostic_attempted)

    def test_three_consecutive_flush_failures_are_required(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream(flush_plan=[False, False, False, False])
            sink = memory_writer(temp, stream)
            for _ in range(2):
                sink._write_physical(b"buffered")
                self.assertFalse(sink._attempt_flush(force=True))
            self.assertEqual(sink.state, "OK")
            self.assertEqual(sink._consecutive_flush_failures, 2)
            sink._write_physical(b"buffered")
            self.assertFalse(sink._attempt_flush(force=True))
            self.assertEqual(sink.state, "FAILED_STICKY")
            self.assertEqual(sink.failure_reason, "flush_failure")
            self.assertTrue(sink._diagnostic_attempted)

    def test_successful_flush_resets_consecutive_failures(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream(flush_plan=[False, False, True, False])
            sink = memory_writer(temp, stream)
            for _ in range(2):
                sink._write_physical(b"buffered")
                self.assertFalse(sink._attempt_flush(force=True))
            sink._write_physical(b"buffered")
            self.assertTrue(sink._attempt_flush(force=True))
            self.assertEqual(sink._consecutive_flush_failures, 0)
            sink._write_physical(b"buffered")
            self.assertFalse(sink._attempt_flush(force=True))
            self.assertEqual(sink._consecutive_flush_failures, 1)
            self.assertEqual(sink.state, "OK")

    def test_physical_write_failure_is_immediately_sticky(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream(fail_write=True)
            sink = memory_writer(temp, stream)
            self.assertFalse(sink._write_row(presence_row(1)))
            self.assertEqual(sink.state, "FAILED_STICKY")
            self.assertEqual(sink.failure_reason, "write_failure")

    def test_final_close_write_failure_is_immediately_sticky(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream(fail_write=True)
            sink = memory_writer(temp, stream)
            sink._close_reason = "DISARM_CLEAN"
            sink._write_close()
            self.assertEqual(sink.state, "FAILED_STICKY")
            self.assertEqual(sink.failure_reason, "write_failure")
            self.assertTrue(sink._diagnostic_attempted)

    def test_admission_value_error_is_counted_without_sticky_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030", autostart=False
            )
            with mock.patch.object(schema, "validate_record",
                                   side_effect=ValueError("invalid record")):
                self.assertFalse(sink.try_put(presence_row(1)))
            self.assertEqual(sink.counters["dropped_serialize"], 1)
            self.assertEqual(sink._pending_drop_reason, "SERIALIZE_FAILURE")
            self.assertEqual(sink.state, "OK")

    def test_writer_serialization_failure_is_counted_without_sticky_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream()
            sink = memory_writer(temp, stream)
            bad = presence_row(1)
            bad["event_kind"] = "not-an-event"
            self.assertFalse(sink._write_row(bad))
            self.assertEqual(sink.counters["dropped_serialize"], 1)
            self.assertEqual(sink._pending_drop_reason, "SERIALIZE_FAILURE")
            self.assertEqual(sink.state, "OK")
            self.assertEqual(stream.write_calls, [])

    def test_shutdown_deadline_provenance_is_on_session_close(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030"
            )
            original = sink._write_physical

            def slow_write(payload):
                written = original(payload)
                time.sleep(0.05)
                return written

            sink._write_physical = slow_write
            for index in range(100):
                self.assertTrue(sink.try_put(presence_row(index)))
            sink.signal_close("DISARM_CLEAN")
            self.assertTrue(sink.wait_idle(8.0))
            rows = written_rows(sink.output_paths[0])
            close = rows[-1]
            self.assertGreater(sink.counters["dropped_queue"], 0)
            self.assertEqual(sink._pending_drop_reason, None)
            self.assertEqual(close["close_reason"], "DISARM_CLEAN")
            self.assertEqual(close["reason"], "SHUTDOWN_DEADLINE")
            self.assertFalse(any(
                row["event_kind"] == "dropped_summary" and
                row["reason"] == "SHUTDOWN_DEADLINE" for row in rows
            ))
            self.assertEqual(close["counters"]["dropped_queue"],
                             sink.counters["dropped_queue"])

    def test_clean_shutdown_has_no_shutdown_reason(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030"
            )
            self.assertTrue(sink.try_put(presence_row(1)))
            sink.signal_close("DISARM_CLEAN")
            self.assertTrue(sink.wait_idle(5.0))
            close = written_rows(sink.output_paths[0])[-1]
            self.assertEqual(sink.counters["dropped_queue"], 0)
            self.assertEqual(close["close_reason"], "DISARM_CLEAN")
            self.assertIsNone(close["reason"])

    def test_shutdown_deadline_keeps_disarm_boundary_when_writer_failed(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream()
            sink = memory_writer(temp, stream)
            sink.state = "FAILED_STICKY"
            sink.failure_reason = "write_failure"
            sink._shutdown_deadline_drops = 1
            sink._close_reason = "DISARM_CLEAN"
            sink._write_close()
            close = stream_rows(stream)[-1]
            self.assertEqual(close["close_reason"], "DISARM_CLEAN")
            self.assertEqual(close["reason"], "SHUTDOWN_DEADLINE")

    def test_buffered_slow_flush_does_not_lose_critical_rows(self):
        with tempfile.TemporaryDirectory() as temp:
            stream = RecordingStream(flush_delay=0.03)
            sink = writer.TelemetryWriter(
                temp, "session-a", "1.0.0", "1.128.90.1030",
                autostart=False,
            )

            def open_fake():
                sink._active_path = os.path.join(temp, "fake.jsonl")
                sink._stream = stream
                sink.output_paths.append(sink._active_path)

            sink._open_active = open_fake
            sink._can_fit = lambda size: (True, True)
            sink.start()
            for index in range(100):
                self.assertTrue(sink.try_put(presence_row(index)))
            sink.signal_close("DISARM_CLEAN")
            self.assertTrue(sink.wait_idle(5.0))
            self.assertEqual(sink.counters["dropped_queue"], 0)
            self.assertGreaterEqual(stream.flush_calls, 1)
            rows = stream_rows(stream)
            self.assertEqual(sum(row["event_kind"] == "presence_snapshot"
                                 for row in rows), 100)


if __name__ == "__main__":
    unittest.main()
