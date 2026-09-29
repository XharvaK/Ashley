import importlib
import os
import sys
import tempfile
import types
import unittest
import weakref
from unittest import mock


SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
if SRC not in sys.path:
    sys.path.insert(0, SRC)


class FakeHandle:
    pass


class FakeWriter:
    instances = []

    def __init__(self, root, session_id, probe_version, sims_build, on_idle=None):
        self.root = root
        self.session_id = session_id
        self.rows = []
        self.counters = {"dropped_queue": 0, "dropped_overrun": 0,
                         "dropped_serialize": 0, "redundant_starts": 0}
        self._idle = False
        self.close_reason = None
        self.on_idle = on_idle
        self.sampling = False
        FakeWriter.instances.append(self)

    @property
    def is_idle(self):
        return self._idle

    def try_put(self, row):
        self.rows.append(row)
        return True

    def signal_close(self, reason):
        self.close_reason = reason

    def set_sampling(self, active):
        self.sampling = active

    def finish(self):
        self._idle = True
        if self.on_idle is not None:
            self.on_idle()


def install_stubs():
    calls = {"registrations": [], "events": [], "alarms": [], "cancelled": []}
    commands = types.ModuleType("sims4.commands")
    commands.CommandType = types.SimpleNamespace(Live="Live")
    commands.CommandRestrictionFlags = types.SimpleNamespace(UNRESTRICTED="UNRESTRICTED")
    def register(*args):
        calls["events"].append("register")
        calls["registrations"].append(args)

    commands.register = register
    sims4 = types.ModuleType("sims4")
    sims4.__path__ = []
    sims4.commands = commands
    sys.modules["sims4"] = sims4
    sys.modules["sims4.commands"] = commands

    alarms = types.ModuleType("alarms")

    def add_alarm_real_time(*args, **kwargs):
        weakref.ref(kwargs["owner"])
        handle = FakeHandle()
        calls["alarms"].append((handle, args, kwargs))
        return handle

    def cancel_alarm(handle):
        calls["cancelled"].append(handle)

    alarms.add_alarm_real_time = add_alarm_real_time
    alarms.cancel_alarm = cancel_alarm
    sys.modules["alarms"] = alarms

    clock = types.ModuleType("clock")
    clock.interval_in_real_seconds = lambda value: value
    sys.modules["clock"] = clock
    date = types.ModuleType("date_and_time")
    date.TimeSpan = lambda value: value
    sys.modules["date_and_time"] = date
    objects = types.ModuleType("objects")
    objects.ALL_HIDDEN_REASONS = object()
    objects.HiddenReasonFlag = types.SimpleNamespace(ALL_HIDDEN_FLAGS="ALL")
    sys.modules["objects"] = objects
    services = types.ModuleType("services")
    services.sim_info_manager = lambda: types.SimpleNamespace(get_all=lambda: [])
    services.client_manager = lambda: types.SimpleNamespace()
    sys.modules["services"] = services

    sims = types.ModuleType("sims")
    sims.__path__ = []
    sys.modules["sims"] = sims
    sims_sim = types.ModuleType("sims.sim")
    sims_sim.Sim = type("Sim", (), {})
    sys.modules["sims.sim"] = sims_sim
    sims_info = types.ModuleType("sims.sim_info")
    sims_info.SimInfo = type("SimInfo", (), {})
    sys.modules["sims.sim_info"] = sims_info

    server = types.ModuleType("server")
    server.__path__ = []
    sys.modules["server"] = server
    clientmanager = types.ModuleType("server.clientmanager")
    sys.modules["server.clientmanager"] = clientmanager

    interactions = types.ModuleType("interactions")
    interactions.__path__ = []
    sys.modules["interactions"] = interactions
    context = types.ModuleType("interactions.context")
    context.InteractionContext = type("InteractionContext", (), {})
    context.SOURCE_SCRIPT = "SCRIPT"
    sys.modules["interactions.context"] = context
    return calls


def load_probe():
    for name in list(sys.modules):
        if name == "ashley_e1" or name.startswith("ashley_e1."):
            del sys.modules[name]
    calls = install_stubs()
    FakeWriter.instances = []
    package = importlib.import_module("ashley_e1")
    probe = importlib.import_module("ashley_e1.probe")
    probe.TelemetryWriter = FakeWriter
    probe._TELEMETRY_ROOT = tempfile.mkdtemp(prefix="ashley-e1-test-")
    return package, probe, calls


class BindingTests(unittest.TestCase):
    def test_valid_stop_clears_handle_only_after_successful_cancel(self):
        _, probe, calls = load_probe()
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())
        handle = probe.get_status()["alarm_handle"]
        writer = FakeWriter.instances[-1]

        self.assertTrue(probe._cmd_stop())

        self.assertEqual(calls["cancelled"], [handle])
        self.assertIsNone(probe.get_status()["alarm_handle"])
        self.assertEqual(probe.get_status()["state"], "ARMED")
        self.assertFalse(writer.sampling)
        self.assertEqual(writer.rows, [])

    def test_cancel_exception_preserves_sampling_and_emits_bounded_failure(self):
        _, probe, _ = load_probe()
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())
        handle = probe.get_status()["alarm_handle"]
        writer = FakeWriter.instances[-1]

        def failing_cancel(value):
            self.assertIs(value, handle)
            raise RuntimeError("do not expose this message")

        probe.alarms.cancel_alarm = failing_cancel

        self.assertFalse(probe._cmd_stop())

        self.assertIs(probe.get_status()["alarm_handle"], handle)
        self.assertEqual(probe.get_status()["state"], "SAMPLING")
        self.assertTrue(writer.sampling)
        self.assertEqual(len(writer.rows), 1)
        self.assertEqual(writer.rows[0]["event_kind"], "guard_exhausted")
        self.assertEqual(writer.rows[0]["reason"], "STOP_CANCEL_FAILURE:RuntimeError")

    def test_invalid_stop_shape_while_active_emits_one_bounded_failure(self):
        _, probe, _ = load_probe()
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        writer = FakeWriter.instances[-1]
        with mock.patch.object(probe, "_cmd_stop") as stop:
            self.assertFalse(probe._dispatch_stop("unexpected", _session_id=42))
            stop.assert_not_called()
        self.assertEqual(len(writer.rows), 1)
        self.assertEqual(writer.rows[0]["event_kind"], "guard_exhausted")
        self.assertEqual(writer.rows[0]["reason"], "STOP_DISPATCH_INVALID_SHAPE")

    def test_invalid_stop_shape_without_session_has_no_alternate_log(self):
        _, probe, _ = load_probe()
        self.assertFalse(probe._dispatch_stop("unexpected", _session_id=42))
        self.assertEqual(FakeWriter.instances, [])

    def test_redundant_stop_while_armed_is_silent_success(self):
        _, probe, _ = load_probe()
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        writer = FakeWriter.instances[-1]
        self.assertTrue(probe._cmd_stop())
        self.assertTrue(probe._cmd_stop())
        self.assertEqual(probe.get_status()["state"], "ARMED")
        self.assertEqual(writer.rows, [])

    def test_disarm_propagates_failed_stop_without_claiming_unarmed(self):
        _, probe, _ = load_probe()
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())
        handle = probe.get_status()["alarm_handle"]
        writer = FakeWriter.instances[-1]

        def failing_cancel(value):
            self.assertIs(value, handle)
            raise RuntimeError("cancel failed")

        probe.alarms.cancel_alarm = failing_cancel

        self.assertFalse(probe._cmd_disarm())

        self.assertEqual(probe.get_status()["state"], "SAMPLING")
        self.assertIs(probe.get_status()["alarm_handle"], handle)
        self.assertIsNone(writer.close_reason)
        self.assertTrue(writer.sampling)
        self.assertEqual(len(writer.rows), 1)
        self.assertEqual(writer.rows[0]["reason"], "STOP_CANCEL_FAILURE:RuntimeError")

    def test_production_registrations_use_target_forms(self):
        _, probe, calls = load_probe()
        self.assertEqual([item[0] for item in calls["registrations"]], [
            "ashley_e1.arm", "ashley_e1.disarm", "ashley_e1.start", "ashley_e1.stop",
        ])
        self.assertEqual(len(calls["registrations"]), 4)
        self.assertEqual([item[2].__name__ for item in calls["registrations"]], [
            "_dispatch_arm", "_dispatch_disarm", "_dispatch_start", "_dispatch_stop",
        ])
        self.assertEqual(calls["registrations"][0][1], "UNRESTRICTED")
        self.assertEqual(calls["registrations"][0][5], "Live")
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_disarm())
        FakeWriter.instances[-1].finish()
        probe._WRITER_IDLE = True
        self.assertTrue(probe._cmd_arm("LAB_E1_FORK"))
        self.assertFalse(probe._cmd_arm("LAB_E1_FORK_EXTRA"))

    def test_native_lowercase_arm_token_maps_to_canonical_name_and_arms(self):
        _, probe, calls = load_probe()
        registered = {item[0]: item[2] for item in calls["registrations"]}
        seen = []
        original_arm = probe._cmd_arm

        def recording_arm(arm_name, _connection=None):
            seen.append((arm_name, _connection))
            return original_arm(arm_name, _connection=_connection)

        probe._cmd_arm = recording_arm
        self.assertTrue(registered["ashley_e1.arm"]("lab_e1", _session_id=3))
        self.assertEqual(seen, [("LAB_E1", 3)])
        self.assertEqual(probe.get_status()["state"], "ARMED")
        self.assertEqual(probe.get_status()["armed_name"], "LAB_E1")
        self.assertEqual(len(FakeWriter.instances), 1)

    def test_native_lowercase_fork_token_maps_to_canonical_name(self):
        _, probe, calls = load_probe()
        registered = {item[0]: item[2] for item in calls["registrations"]}
        seen = []

        def recording_arm(arm_name, _connection=None):
            seen.append((arm_name, _connection))
            return True

        probe._cmd_arm = recording_arm
        self.assertTrue(registered["ashley_e1.arm"]("lab_e1_fork", _session_id=4))
        self.assertEqual(seen, [("LAB_E1_FORK", 4)])

    def test_start_is_single_alarm_and_repeated_start_is_noop_success(self):
        _, probe, calls = load_probe()
        self.assertFalse(probe._cmd_start())
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())
        self.assertTrue(probe._cmd_start())
        self.assertEqual(len(calls["alarms"]), 1)
        self.assertTrue(FakeWriter.instances[-1].sampling)
        self.assertEqual(probe.get_status()["counters"]["redundant_starts"], 1)
        self.assertTrue(probe._cmd_stop())
        self.assertEqual(len(calls["cancelled"]), 1)
        self.assertFalse(FakeWriter.instances[-1].sampling)
        self.assertTrue(probe._cmd_disarm())

    def test_start_forwards_interval_sentinel_and_exact_alarm_arguments(self):
        _, probe, calls = load_probe()
        sentinel = object()
        constructed = []

        def replacement_time_span(value):
            constructed.append(value)
            return object()

        probe.interval_in_real_seconds = lambda seconds: sentinel
        probe.TimeSpan = replacement_time_span
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())

        _, args, kwargs = calls["alarms"][0]
        self.assertEqual(args, ())
        self.assertIs(kwargs["owner"], probe._PROBE_ALARM_OWNER)
        self.assertIs(kwargs["time_span"], sentinel)
        self.assertIs(kwargs["callback"], probe._poll_tick)
        self.assertTrue(kwargs["repeating"])
        self.assertFalse(kwargs["use_sleep_time"])
        self.assertFalse(kwargs["cross_zone"])
        self.assertEqual(constructed, [])
        self.assertEqual(probe.get_status()["state"], "SAMPLING")
        self.assertTrue(FakeWriter.instances[-1].sampling)

    def test_alarm_owner_is_weak_referenceable_and_singleton_across_cycles(self):
        _, probe, _ = load_probe()
        owner = probe._PROBE_ALARM_OWNER
        self.assertIs(weakref.ref(owner)(), owner)

        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())
        self.assertTrue(probe._cmd_stop())
        self.assertTrue(probe._cmd_disarm())
        FakeWriter.instances[-1].finish()
        probe._WRITER_IDLE = True
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())
        self.assertIs(probe._PROBE_ALARM_OWNER, owner)

    def test_start_does_not_construct_timespan_around_interval_result(self):
        _, probe, calls = load_probe()
        sentinel = object()
        constructed = []

        def fail_if_constructed(value):
            constructed.append(value)
            raise AssertionError("nested TimeSpan construction")

        probe.interval_in_real_seconds = lambda seconds: sentinel
        probe.TimeSpan = fail_if_constructed
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())
        self.assertEqual(constructed, [])
        self.assertIs(calls["alarms"][0][2]["time_span"], sentinel)

    def test_start_alarm_construction_failure_remains_fail_closed(self):
        _, probe, calls = load_probe()

        def failing_add_alarm(*args, **kwargs):
            raise RuntimeError("alarm construction failed")

        probe.alarms.add_alarm_real_time = failing_add_alarm
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertFalse(probe._cmd_start())
        self.assertIsNone(probe.get_status()["alarm_handle"])
        self.assertEqual(probe.get_status()["state"], "ARMED")
        self.assertFalse(FakeWriter.instances[-1].sampling)
        self.assertEqual(calls["alarms"], [])

    def test_arm_while_sampling_is_rejected_and_state_is_unchanged(self):
        _, probe, _ = load_probe()
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())
        self.assertFalse(probe._cmd_arm("LAB_E1_FORK"))
        self.assertEqual(probe.get_status()["armed_name"], "LAB_E1")

    def test_dead_alarm_handle_stops_sampling_for_explicit_rearm(self):
        _, probe, calls = load_probe()
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())
        probe._poll_tick(FakeHandle())
        self.assertEqual(probe.get_status()["state"], "ARMED")
        self.assertEqual(len(calls["cancelled"]), 1)

    def test_first_successful_poll_populates_snapshot_before_session_open(self):
        _, probe, calls = load_probe()
        from ashley_e1 import schema
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())
        row = schema.make_record(
            "presence_snapshot", telemetry_session_id=probe.get_status()["telemetry_session_id"],
            wall_timestamp_ms=10, monotonic_ns=20, observation_complete=True,
            attestation=schema.attestation("LAB_E1"),
            save={"save_slot_guid": "guid", "slot_id": "slot"},
            body={"sim_id": "sim", "instantiated": True, "is_selectable": True,
                  "is_selected": None, "posture": None},
            interactions={"observed": [], "queue_truncated": False,
                          "running_truncated": False, "observation_complete": True},
        )
        probe.observers.poll_once = lambda session, name: row
        probe._poll_tick(calls["alarms"][0][0])
        self.assertEqual(probe.get_status()["armed_snapshot"]["sim_id"], "sim")
        rows = FakeWriter.instances[-1].rows
        self.assertEqual([item["event_kind"] for item in rows],
                         ["session_open", "presence_snapshot"])

    def test_incomplete_session_identity_fails_closed_before_session_open(self):
        from ashley_e1 import schema

        for missing in ("save_slot_guid", "slot_id", "sim_id"):
            with self.subTest(missing=missing):
                _, probe, calls = load_probe()
                self.assertTrue(probe._cmd_arm("LAB_E1"))
                self.assertTrue(probe._cmd_start())
                save = {"save_slot_guid": "guid", "slot_id": "slot"}
                body = {"sim_id": "sim", "instantiated": True,
                        "is_selectable": True, "is_selected": None,
                        "posture": None}
                if missing in save:
                    save[missing] = None
                else:
                    body[missing] = None
                row = schema.make_record(
                    "presence_snapshot",
                    telemetry_session_id=probe.get_status()["telemetry_session_id"],
                    wall_timestamp_ms=10, monotonic_ns=20,
                    observation_complete=True,
                    attestation=schema.attestation("LAB_E1"),
                    save=save, body=body,
                    interactions={"observed": [], "queue_truncated": False,
                                  "running_truncated": False,
                                  "observation_complete": True},
                )
                opened = []
                original_session_open = probe._session_open_from
                probe._session_open_from = lambda value: (
                    opened.append(value), original_session_open(value))[1]
                probe.observers.poll_once = lambda session, name, row=row: row
                probe._poll_tick(calls["alarms"][0][0])

                writer = FakeWriter.instances[-1]
                self.assertEqual(opened, [])
                self.assertEqual([item["event_kind"] for item in writer.rows],
                                 ["guard_exhausted"])
                self.assertEqual(
                    writer.rows[0]["reason"],
                    "OBSERVATION_FAILURE:SESSION_OPEN_IDENTITY_INCOMPLETE",
                )
                schema.validate_record(writer.rows[0])
                self.assertIsNone(writer.rows[0]["save"]["save_slot_guid"])
                self.assertIsNone(writer.rows[0]["save"]["slot_id"])
                self.assertIsNone(writer.rows[0]["body"]["sim_id"])
                self.assertIsNone(probe.get_status()["armed_snapshot"])
                self.assertFalse(probe._SESSION_OPENED)
                self.assertEqual(probe.get_status()["state"], "ARMED")
                self.assertFalse(writer.sampling)

    def test_reentrant_poll_is_counted_as_overrun(self):
        _, probe, _ = load_probe()
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())
        probe._POLL_BUSY = True
        probe._poll_tick()
        probe._POLL_BUSY = False
        self.assertEqual(probe.get_status()["counters"]["dropped_overrun"], 1)

    def test_native_dispatch_adapters_preserve_state_machine_and_translate_session(self):
        _, probe, calls = load_probe()
        registered = {item[0]: item[2] for item in calls["registrations"]}
        seen_connections = []
        original_arm = probe._cmd_arm

        def recording_arm(arm_name, _connection=None):
            seen_connections.append((arm_name, _connection))
            return original_arm(arm_name, _connection=_connection)

        probe._cmd_arm = recording_arm
        self.assertFalse(registered["ashley_e1.start"](_session_id=42))
        self.assertEqual(calls["alarms"], [])
        self.assertEqual(FakeWriter.instances, [])
        self.assertFalse(registered["ashley_e1.arm"]("BADNAME", _session_id=42))
        self.assertEqual(probe.get_status()["state"], "UNARMED")

        self.assertTrue(registered["ashley_e1.arm"]("lab_e1", _session_id=42))
        self.assertEqual(seen_connections, [("LAB_E1", 42)])
        self.assertEqual(probe.get_status()["state"], "ARMED")
        self.assertEqual(len(FakeWriter.instances), 1)

        self.assertTrue(registered["ashley_e1.start"](_session_id=42))
        self.assertEqual(probe.get_status()["state"], "SAMPLING")
        self.assertEqual(len(calls["alarms"]), 1)
        self.assertTrue(registered["ashley_e1.start"](_session_id=42))
        self.assertEqual(len(calls["alarms"]), 1)
        self.assertEqual(probe.get_status()["counters"]["redundant_starts"], 1)

        self.assertFalse(registered["ashley_e1.arm"]("lab_e1_fork", _session_id=42))
        self.assertEqual(probe.get_status()["state"], "SAMPLING")
        self.assertTrue(registered["ashley_e1.stop"](_session_id=42))
        self.assertEqual(probe.get_status()["state"], "ARMED")
        self.assertTrue(registered["ashley_e1.stop"](_session_id=42))
        self.assertTrue(registered["ashley_e1.disarm"](_session_id=42))
        self.assertEqual(probe.get_status()["state"], "UNARMED")

    def test_native_dispatch_adapters_fail_closed_on_wrong_argument_cardinality(self):
        _, probe, calls = load_probe()
        registered = {item[0]: item[2] for item in calls["registrations"]}

        self.assertFalse(registered["ashley_e1.arm"](_session_id=42))
        self.assertFalse(registered["ashley_e1.arm"]("LAB_E1", "extra", _session_id=42))
        self.assertFalse(registered["ashley_e1.arm"](
            "LAB_E1", _session_id=42, unexpected=True))
        self.assertFalse(registered["ashley_e1.arm"]("badname", _session_id=42))
        self.assertFalse(registered["ashley_e1.arm"](7, _session_id=42))
        for name in ("ashley_e1.disarm", "ashley_e1.start", "ashley_e1.stop"):
            self.assertFalse(registered[name]("extra", _session_id=42))
            self.assertFalse(registered[name](_session_id=42, unexpected=True))

        self.assertEqual(probe.get_status()["state"], "UNARMED")
        self.assertEqual(FakeWriter.instances, [])
        self.assertEqual(calls["alarms"], [])

    def test_old_direct_semantic_handler_does_not_match_native_session_keyword(self):
        _, probe, calls = load_probe()
        registered_start = {
            item[0]: item[2] for item in calls["registrations"]
        }["ashley_e1.start"]
        with self.assertRaises(TypeError):
            probe._cmd_start(_session_id=42)
        self.assertFalse(registered_start(_session_id=42))
        self.assertFalse(probe._cmd_arm("lab_e1"))
        self.assertTrue(probe._cmd_arm("LAB_E1"))


if __name__ == "__main__":
    unittest.main()
