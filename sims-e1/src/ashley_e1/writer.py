"""Bounded background JSONL writer. This module has no game imports."""

import json
import os
import queue
import threading
import time
import uuid

from . import schema


QUEUE_CAPACITY = 1024
MAX_ACTIVE_FILE_BYTES = 8 * 1024 * 1024
MAX_ROTATED_SIBLINGS_PER_SESSION = 4
MAX_TELEMETRY_DIR_BYTES = 200 * 1024 * 1024


def derive_telemetry_root(module_path):
    """Return the telemetry directory for an installed Mods/AshleyE1 path."""
    if not isinstance(module_path, str):
        return None
    normalized = os.path.realpath(os.path.normpath(os.path.abspath(module_path)))
    drive, tail = os.path.splitdrive(normalized)
    parts = [part for part in tail.replace("/", "\\").split("\\") if part]
    pair_index = None
    for index in range(len(parts) - 2, -1, -1):
        if (os.path.normcase(parts[index]) == "mods" and
                os.path.normcase(parts[index + 1]) == "ashleye1"):
            pair_index = index
            break
    if pair_index is None or pair_index == 0:
        return None
    if len(parts) - pair_index > 6:
        return None
    root_tail = "\\".join(parts[:pair_index])
    root = drive + "\\" + root_tail if drive else os.sep + root_tail
    return os.path.normpath(os.path.join(root, "AshleyE1Telemetry"))


def _directory_size(root):
    total = 0
    try:
        for name in os.listdir(root):
            path = os.path.join(root, name)
            if os.path.isfile(path):
                total += os.path.getsize(path)
    except OSError:
        return None
    return total


def bootstrap_from_module_path(module_path, probe_version, sims_build,
                               required_imports):
    root = derive_telemetry_root(module_path)
    if root is None:
        return None
    os.makedirs(root, exist_ok=True)
    boot_id = str(uuid.uuid4())
    row = schema.make_load_disabled_record(
        boot_id, int(time.time() * 1000), time.perf_counter_ns(),
        {"python_version": "3.7.0", "perf_counter": True,
         "required_imports": dict(required_imports)},
        probe_version=probe_version, sims_build=sims_build,
    )
    path = os.path.join(root, "ashley_e1_bootstrap_%s.jsonl" % boot_id)
    payload = schema.serialize_record(row)
    with open(path, "wb") as handle:
        handle.write(payload + b"\n")
        handle.flush()
    return root


def validate_jsonl_lines(lines):
    parsed = []
    truncated_tail = False
    for index, line in enumerate(lines):
        if not line:
            continue
        try:
            parsed.append(json.loads(line))
        except (TypeError, ValueError):
            if index == len(lines) - 1 and not truncated_tail:
                truncated_tail = True
                continue
            return {"valid": False, "reason": "corrupt line", "truncated_tail": False}
    for expected, row in enumerate(parsed):
        if row.get("written_sequence") != expected:
            return {"valid": False, "reason": "sequence gap", "truncated_tail": truncated_tail}
    return {"valid": True, "reason": None, "truncated_tail": truncated_tail}


class TelemetryWriter:
    """One bounded queue and one writer thread for a telemetry session."""

    def __init__(self, root, session_id, probe_version, sims_build,
                 queue_capacity=QUEUE_CAPACITY,
                 max_file_bytes=MAX_ACTIVE_FILE_BYTES,
                 max_rotations=MAX_ROTATED_SIBLINGS_PER_SESSION,
                 max_dir_bytes=MAX_TELEMETRY_DIR_BYTES,
                 on_idle=None,
                 autostart=True):
        self.root = os.path.normpath(root)
        self.session_id = session_id
        self.probe_version = probe_version
        self.sims_build = sims_build
        self._queue = queue.Queue(maxsize=queue_capacity)
        self.max_file_bytes = max_file_bytes
        self.max_rotations = max_rotations
        self.max_dir_bytes = max_dir_bytes
        self.counters = {"dropped_queue": 0, "dropped_overrun": 0,
                         "dropped_serialize": 0, "redundant_starts": 0}
        self.state = "OK"
        self.capture_stopped = False
        self.failure_reason = None
        self.output_paths = []
        self.rotation_index = 0
        self._sequence = 0
        self._stream = None
        self._active_path = None
        self._stop_event = threading.Event()
        self._thread = None
        self._idle = True
        self._close_reason = None
        self._close_written = False
        self._pre_disarm_requested = False
        self._pending_drop_reason = None
        self._last_drop_summary = 0.0
        self._last_checkpoint = time.time()
        self._last_game = None
        self._sampling = False
        self._diagnostic_attempted = False
        self._lock = threading.RLock()
        self._on_idle = on_idle
        if autostart:
            self.start()

    @property
    def is_idle(self):
        return self._idle

    def start(self):
        if self._thread is not None:
            return
        os.makedirs(self.root, exist_ok=True)
        self._idle = False
        self._thread = threading.Thread(target=self._run, name="ashley-e1-writer")
        self._thread.daemon = True
        self._thread.start()

    def set_sampling(self, active):
        self._sampling = bool(active)

    def note_drop(self, reason):
        if reason in ("QUEUE_SATURATION", "SAMPLER_OVERRUN", "SERIALIZE_FAILURE"):
            self._pending_drop_reason = reason

    def queued_event_kinds(self):
        with self._queue.mutex:
            return [item.get("event_kind") for item in list(self._queue.queue)]

    def _evict_preferred(self):
        with self._queue.mutex:
            for preferred in ("clock_snapshot", "zone_snapshot"):
                for index, item in enumerate(self._queue.queue):
                    if item.get("event_kind") == preferred:
                        del self._queue.queue[index]
                        self._queue.unfinished_tasks -= 1
                        return preferred
        return None

    def try_put(self, row):
        if self.capture_stopped:
            return False
        try:
            schema.validate_record(row)
        except (schema.SchemaError, TypeError):
            self.counters["dropped_serialize"] += 1
            self._pending_drop_reason = "SERIALIZE_FAILURE"
            return False
        try:
            self._queue.put_nowait(row)
            return True
        except queue.Full:
            evicted = self._evict_preferred()
            if evicted is not None:
                self.counters["dropped_queue"] += 1
                self._pending_drop_reason = "QUEUE_SATURATION"
                try:
                    self._queue.put_nowait(row)
                    return True
                except queue.Full:
                    pass
            self.counters["dropped_queue"] += 1
            self._pending_drop_reason = "QUEUE_SATURATION"
            self.capture_stopped = True
            self.failure_reason = "saturation_critical"
            return False

    def signal_close(self, close_reason):
        self._close_reason = close_reason
        self._pre_disarm_requested = True
        self._stop_event.set()

    def wait_idle(self, timeout=5.0):
        deadline = time.time() + timeout
        while not self._idle and time.time() < deadline:
            time.sleep(0.01)
        return self._idle

    def _new_path(self):
        base = os.path.join(self.root, "ashley_e1_%s.jsonl" % self.session_id)
        if self.rotation_index:
            base += ".%d" % self.rotation_index
        return base

    def _open_active(self):
        path = self._new_path()
        stream = open(path, "xb")
        self._active_path = path
        self._stream = stream
        self.output_paths.append(path)

    def _close_stream(self):
        if self._stream is not None:
            try:
                self._stream.flush()
            finally:
                self._stream.close()
            self._stream = None

    def _can_fit(self, size):
        current = os.path.getsize(self._active_path) if self._active_path and os.path.exists(self._active_path) else 0
        total = _directory_size(self.root)
        return total is not None and total + size <= self.max_dir_bytes, current + size <= self.max_file_bytes

    def _mark_failure(self, state, reason):
        self.state = state
        self.capture_stopped = True
        self.failure_reason = reason
        if not self._diagnostic_attempted:
            self._diagnostic_attempted = True
            kind = "cap_reached" if state == "CAP_REACHED" else "writer_failed"
            try:
                self._write_diagnostic(kind, reason)
            except (OSError, IOError, schema.SchemaError, TypeError, ValueError):
                pass

    def _write_physical(self, payload):
        if self._stream is None:
            return False
        fits_dir, fits_file = self._can_fit(len(payload) + 1)
        if not fits_dir or not fits_file:
            return False
        self._stream.write(payload + b"\n")
        self._stream.flush()
        self._sequence += 1
        return True

    def _write_diagnostic(self, kind, reason):
        row = schema.make_record(
            kind, telemetry_session_id=self.session_id,
            wall_timestamp_ms=int(time.time() * 1000),
            monotonic_ns=time.perf_counter_ns(), reason=reason,
            counters=dict(self.counters),
            writer={"state": self.state, "rotation_index": self.rotation_index},
        )
        row["written_sequence"] = self._sequence
        payload = schema.serialize_record(row)
        return self._write_physical(payload)

    def _write_checkpoint(self, reason):
        payload = {
            "checkpoint_reason": reason,
            "counters": dict(self.counters),
            "writer": {"state": self.state, "rotation_index": self.rotation_index},
        }
        if reason == "PERIODIC_60S" and self._last_game is not None:
            payload["game"] = dict(self._last_game)
        checkpoint = schema.make_record(
            "session_checkpoint", telemetry_session_id=self.session_id,
            wall_timestamp_ms=int(time.time() * 1000),
            monotonic_ns=time.perf_counter_ns(), **payload
        )
        checkpoint["written_sequence"] = self._sequence
        try:
            payload = schema.serialize_record(checkpoint)
            written = self._write_physical(payload)
        except (OSError, IOError, schema.SchemaError, TypeError, ValueError):
            self._mark_failure("FAILED_STICKY", "write_failure")
            return False
        if not written:
            self._mark_failure("CAP_REACHED", "checkpoint_cap")
            return False
        self._last_checkpoint = time.time()
        return True

    def _write_direct(self, row):
        if self.state != "OK":
            return False
        row = dict(row)
        if self._stream is None:
            self._open_active()
        row["written_sequence"] = self._sequence
        payload = schema.serialize_record(row)
        fits_dir, fits_file = self._can_fit(len(payload) + 1)
        if not fits_dir:
            self._mark_failure("CAP_REACHED", "directory_cap")
            return False
        if not fits_file:
            if self.rotation_index >= self.max_rotations:
                self._mark_failure("CAP_REACHED", "rotation_cap")
                return False
            self._close_stream()
            self.rotation_index += 1
            try:
                self._open_active()
            except (OSError, IOError):
                self._mark_failure("FAILED_STICKY", "write_failure")
                return False
            if not self._write_checkpoint("ROTATION"):
                return False
            row["written_sequence"] = self._sequence
            payload = schema.serialize_record(row)
            fits_dir, fits_file = self._can_fit(len(payload) + 1)
            if not fits_dir:
                self._mark_failure("CAP_REACHED", "directory_cap")
                return False
            if not fits_file:
                self._mark_failure("CAP_REACHED", "record_cap")
                return False
        written = self._write_physical(payload)
        if not written and self.state == "OK":
            if self._stream is None:
                self._mark_failure("FAILED_STICKY", "write_failure")
            else:
                self._mark_failure("CAP_REACHED", "capacity_race")
        return written

    def _write_row(self, row):
        if self.state != "OK":
            return False
        now = time.time()
        incoming_game = row.get("game") if isinstance(row, dict) else None
        if isinstance(incoming_game, dict) and any(
                value is not None for value in incoming_game.values()):
            self._last_game = incoming_game
        if self._sampling and self._sequence and now - self._last_checkpoint >= 60.0:
            if not self._write_checkpoint("PERIODIC_60S"):
                return False
        if self._pending_drop_reason is not None and now - self._last_drop_summary >= 1.0:
            summary = schema.make_record(
                "dropped_summary", telemetry_session_id=self.session_id,
                wall_timestamp_ms=int(now * 1000), monotonic_ns=time.perf_counter_ns(),
                reason=self._pending_drop_reason, counters=dict(self.counters),
                writer={"state": self.state, "rotation_index": self.rotation_index},
            )
            try:
                self._write_direct(summary)
                self._last_drop_summary = now
                self._pending_drop_reason = None
            except (OSError, IOError, schema.SchemaError, TypeError, ValueError):
                self._mark_failure("FAILED_STICKY", "write_failure")
                return False
        row = dict(row)
        row["counters"] = dict(self.counters)
        row["writer"] = {"state": self.state, "rotation_index": self.rotation_index}
        try:
            return self._write_direct(row)
        except (OSError, IOError, schema.SchemaError, TypeError, ValueError):
            self._mark_failure("FAILED_STICKY", "write_failure")
            return False

    def _write_close(self):
        if self._close_written or self._close_reason is None:
            return
        if self._pre_disarm_requested and self.state == "OK":
            self._write_checkpoint("PRE_DISARM")
        row = schema.make_record(
            "session_close", telemetry_session_id=self.session_id,
            wall_timestamp_ms=int(time.time() * 1000),
            monotonic_ns=time.perf_counter_ns(),
            close_reason=(self._close_reason if self.state == "OK" else self.state),
            counters=dict(self.counters), writer={"state": self.state,
                                                  "rotation_index": self.rotation_index},
        )
        row["written_sequence"] = self._sequence
        try:
            payload = schema.serialize_record(row)
            self._close_written = self._write_physical(payload)
        except (OSError, IOError, schema.SchemaError, TypeError, ValueError):
            self._close_written = False

    def _run(self):
        deadline = None
        try:
            try:
                self._open_active()
            except (OSError, IOError):
                self._mark_failure("FAILED_STICKY", "write_failure")
            while True:
                try:
                    row = self._queue.get(timeout=0.05)
                except queue.Empty:
                    if self._stop_event.is_set():
                        if deadline is None:
                            deadline = time.time() + 2.0
                        if not self._queue.unfinished_tasks or time.time() >= deadline:
                            break
                    continue
                try:
                    self._write_row(row)
                finally:
                    self._queue.task_done()
                if self._stop_event.is_set() and deadline is None:
                    deadline = time.time() + 2.0
                if deadline is not None and time.time() >= deadline:
                    while True:
                        try:
                            self._queue.get_nowait()
                        except queue.Empty:
                            break
                        self._queue.task_done()
                        self.counters["dropped_queue"] += 1
                    self._pending_drop_reason = "SHUTDOWN_DEADLINE"
                    break
            self._write_close()
        finally:
            self._close_stream()
            self._idle = True
            if self._on_idle is not None:
                self._on_idle()
