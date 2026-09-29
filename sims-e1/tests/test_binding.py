import importlib
import os
import sys
import tempfile
import types
import unittest


SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))


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
        FakeWriter.instances.append(self)

    @property
    def is_idle(self):
        return self._idle

    def try_put(self, row):
        self.rows.append(row)
        return True

    def signal_close(self, reason):
        self.close_reason = reason

    def finish(self):
        self._idle = True
        if self.on_idle is not None:
            self.on_idle()


def install_stubs():
    calls = {"registrations": [], "alarms": [], "cancelled": []}
    commands = types.ModuleType("sims4.commands")
    commands.CommandType = types.SimpleNamespace(Live="Live")
    commands.CommandRestrictionFlags = types.SimpleNamespace(UNRESTRICTED="UNRESTRICTED")

    def register(*args):
        calls["registrations"].append(args)

    commands.register = register
    sims4 = types.ModuleType("sims4")
    sims4.__path__ = []
    sims4.commands = commands
    sys.modules["sims4"] = sims4
    sys.modules["sims4.commands"] = commands

    alarms = types.ModuleType("alarms")

    def add_alarm_real_time(*args, **kwargs):
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
    objects.HiddenReasonFlag = types.SimpleNamespace(ALL_HIDDEN_FLAGS="ALL")
    sys.modules["objects"] = objects
    services = types.ModuleType("services")
    sys.modules["services"] = services
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
    def test_exactly_four_registrations_and_five_forms(self):
        _, probe, calls = load_probe()
        self.assertEqual([item[0] for item in calls["registrations"]], [
            "ashley_e1.arm", "ashley_e1.disarm", "ashley_e1.start", "ashley_e1.stop",
        ])
        self.assertEqual(len(calls["registrations"]), 4)
        self.assertEqual(calls["registrations"][0][1], "UNRESTRICTED")
        self.assertEqual(calls["registrations"][0][5], "Live")
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_disarm())
        FakeWriter.instances[-1].finish()
        probe._WRITER_IDLE = True
        self.assertTrue(probe._cmd_arm("LAB_E1_FORK"))
        self.assertFalse(probe._cmd_arm("LAB_E1_FORK_EXTRA"))

    def test_start_is_single_alarm_and_repeated_start_is_noop_success(self):
        _, probe, calls = load_probe()
        self.assertFalse(probe._cmd_start())
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())
        self.assertTrue(probe._cmd_start())
        self.assertEqual(len(calls["alarms"]), 1)
        self.assertEqual(probe.get_status()["counters"]["redundant_starts"], 1)
        self.assertTrue(probe._cmd_stop())
        self.assertEqual(len(calls["cancelled"]), 1)
        self.assertTrue(probe._cmd_disarm())

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

    def test_reentrant_poll_is_counted_as_overrun(self):
        _, probe, _ = load_probe()
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertTrue(probe._cmd_start())
        probe._POLL_BUSY = True
        probe._poll_tick()
        probe._POLL_BUSY = False
        self.assertEqual(probe.get_status()["counters"]["dropped_overrun"], 1)


if __name__ == "__main__":
    unittest.main()
