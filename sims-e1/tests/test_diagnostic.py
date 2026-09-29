import json
import os
import unittest

from test_binding import FakeWriter, load_probe


def diagnostic_path(probe):
    return os.path.join(
        probe._TELEMETRY_ROOT,
        "ashley_e1_command_dispatch_diag_1.0.4.jsonl",
    )


def read_rows(probe):
    with open(diagnostic_path(probe), "r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


class DiagnosticTests(unittest.TestCase):
    def test_initialize_emits_one_diagnostic_bootstrap_and_is_idempotent(self):
        _, probe, _ = load_probe()
        probe._INITIALIZED = False
        probe.derive_telemetry_root = lambda path: probe._TELEMETRY_ROOT
        probe.bootstrap_from_module_path = lambda *args, **kwargs: None
        probe.initialize_probe()
        probe.initialize_probe()
        rows = read_rows(probe)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["diagnostic_kind"], "bootstrap")

    def test_bootstrap_records_native_bridge_shape(self):
        _, probe, _ = load_probe()
        self.assertTrue(probe._write_diagnostic_bootstrap(
            probe._TELEMETRY_ROOT, probe._commands_module,
            probe.register, probe.Command))
        rows = read_rows(probe)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["diagnostic_version"], "1.0.4")
        self.assertEqual(row["diagnostic_kind"], "bootstrap")
        self.assertNotIn("event_kind", row)
        self.assertTrue(row["native_bridge_attribute_present"])
        self.assertIs(type(row["native_bridge_enabled"]), bool)
        self.assertTrue(row["native_bridge_enabled"])
        self.assertTrue(row["native_commands_attribute_present"])
        self.assertEqual(row["native_commands_type"], "module")
        self.assertTrue(row["native_commands_in_sys_modules"])
        self.assertEqual(row["sys_modules_native_commands_type"], "module")
        self.assertTrue(row["register_callable"])
        self.assertTrue(row["command_callable"])

    def test_raw_handler_accepts_all_argument_shapes(self):
        _, probe, calls = load_probe()
        raw = {item[0]: item[2] for item in calls["registrations"]}["ashley_e1.diag_raw"]
        self.assertFalse(raw())
        self.assertFalse(raw("alpha", 7, _session_id=42, unexpected="value"))
        rows = read_rows(probe)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[-1]["positional_count"], 2)
        self.assertEqual(rows[-1]["keyword_names"], ["unexpected"])
        self.assertEqual(rows[-1]["session_id"]["repr"], "42")

    def test_raw_handler_does_not_touch_probe_state_or_runtime_apis(self):
        _, probe, calls = load_probe()
        raw = {item[0]: item[2] for item in calls["registrations"]}["ashley_e1.diag_raw"]
        state_before = probe.get_status()
        touched = []

        def forbidden(*args, **kwargs):
            touched.append((args, kwargs))
            raise AssertionError("diagnostic raw dispatch touched E1 runtime")

        probe._cmd_arm = forbidden
        probe._cmd_start = forbidden
        probe.TelemetryWriter = forbidden
        probe._alarms_add_alarm_real_time = forbidden
        probe.observers.poll_once = forbidden
        self.assertFalse(raw("x", _session_id=9))
        self.assertEqual(touched, [])
        self.assertEqual(probe.get_status(), state_before)
        self.assertEqual(calls["alarms"], [])
        self.assertEqual(FakeWriter.instances, [])

    def test_decorated_control_writes_bounded_evidence_without_state_change(self):
        _, probe, calls = load_probe()
        wrapped = {item[0]: item[2] for item in calls["registrations"]}["ashley_e1.diag_wrapped"]
        state_before = probe.get_status()
        self.assertFalse(wrapped(_session_id=42))
        self.assertEqual(probe.get_status(), state_before)
        row = read_rows(probe)[-1]
        self.assertEqual(row["diagnostic_kind"], "wrapped_dispatch")
        self.assertEqual(row["connection"]["repr"], "42")
        self.assertEqual(row["account"]["repr"], "42")
        self.assertEqual(calls["alarms"], [])
        self.assertEqual(FakeWriter.instances, [])

    def test_rows_bound_repr_failures_and_large_values(self):
        class BadRepr:
            def __repr__(self):
                raise RuntimeError("repr failed")

        class HugeRepr:
            def __repr__(self):
                return "x" * 100000

        _, probe, calls = load_probe()
        raw = {item[0]: item[2] for item in calls["registrations"]}["ashley_e1.diag_raw"]
        self.assertFalse(raw(BadRepr(), HugeRepr(), _session_id=BadRepr(), huge=HugeRepr()))
        path = diagnostic_path(probe)
        self.assertLess(os.path.getsize(path), 4096)
        row = read_rows(probe)[-1]
        self.assertEqual(row["session_id"]["repr"], "<repr_error>")
        for item in row["positional"]:
            self.assertLessEqual(len(item["repr"]), 120)
        for item in row["keywords"]:
            self.assertLessEqual(len(item["repr"]), 120)


if __name__ == "__main__":
    unittest.main()
