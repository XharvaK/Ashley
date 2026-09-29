import json
import importlib
import os
import sys
import tempfile
import unittest

from test_binding import FakeWriter, load_probe


class BootstrapTests(unittest.TestCase):
    def test_package_initializes_once_and_secondary_imports_are_pure(self):
        package, probe, calls = load_probe()
        self.assertEqual(len(calls["registrations"]), 8)
        probe.initialize_probe()
        self.assertEqual(len(calls["registrations"]), 8)
        self.assertEqual(len(calls["alarms"]), 0)
        for name in ("observers", "snapshot", "schema", "writer", "e2_admission",
                     "e2_lineage", "e2_registry", "e2_actuator", "e2_control"):
            importlib.import_module("ashley_e1." + name)
        self.assertEqual(len(calls["registrations"]), 8)
        self.assertEqual(calls["pushes"], [])
        self.assertEqual(calls["speed"], [])
        self.assertEqual(calls["save_callbacks"], [])
        self.assertEqual(len(calls["alarms"]), 0)

    def test_no_alarm_exists_before_explicit_start(self):
        _, probe, calls = load_probe()
        self.assertEqual(calls["alarms"], [])
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertEqual(calls["alarms"], [])
        self.assertTrue(probe._cmd_start())
        self.assertEqual(len(calls["alarms"]), 1)

    def test_initialize_passes_closed_import_summary_to_bootstrap(self):
        _, probe, calls = load_probe()
        captured = []
        probe._INITIALIZED = False
        probe.derive_telemetry_root = lambda path: tempfile.mkdtemp(prefix="ashley-e1-root-")
        probe.bootstrap_from_module_path = lambda *args, **kwargs: captured.append((args, kwargs))
        probe.initialize_probe()
        self.assertEqual(len(captured), 1)
        summary = captured[0][1]["required_imports"]
        from ashley_e1 import schema
        self.assertEqual(set(summary), set(schema.REQUIRED_IMPORT_KEYS))
        self.assertTrue(all(type(value) is bool for value in summary.values()))
        self.assertTrue(all(summary.values()))
        self.assertEqual(probe.get_status()["state"], "UNARMED")
        self.assertEqual(calls["alarms"], [])
        self.assertEqual(FakeWriter.instances, [])

    def test_command_registration_precedes_bootstrap_emission(self):
        _, probe, calls = load_probe()
        probe._INITIALIZED = False
        calls["events"][:] = []
        probe.derive_telemetry_root = lambda path: tempfile.mkdtemp(
            prefix="ashley-e1-root-")
        probe.bootstrap_from_module_path = lambda *args, **kwargs: calls["events"].append(
            "bootstrap")
        probe.initialize_probe()

        self.assertEqual(calls["events"], ["register"] * 8 + ["bootstrap"])
        self.assertEqual(len(calls["registrations"]), 16)
        self.assertEqual(probe.get_status()["state"], "UNARMED")
        self.assertEqual(calls["alarms"], [])
        self.assertEqual(FakeWriter.instances, [])

    def test_registration_exception_emits_no_successful_bootstrap_witness(self):
        _, probe, calls = load_probe()
        events = []
        probe._INITIALIZED = False

        def failing_register(*args, **kwargs):
            events.append("register")
            raise RuntimeError("registration failed")

        probe.register = failing_register
        probe.derive_telemetry_root = lambda path: tempfile.mkdtemp(
            prefix="ashley-e1-root-")
        probe.bootstrap_from_module_path = lambda *args, **kwargs: events.append(
            "bootstrap")

        with self.assertRaisesRegex(RuntimeError, "registration failed"):
            probe.initialize_probe()

        self.assertEqual(events, ["register"])
        self.assertFalse(probe._INITIALIZED)
        self.assertEqual(calls["alarms"], [])
        self.assertEqual(FakeWriter.instances, [])

    def test_successful_initialization_emits_one_bootstrap_and_is_idempotent(self):
        _, probe, _ = load_probe()
        events = []
        probe._INITIALIZED = False
        probe.derive_telemetry_root = lambda path: tempfile.mkdtemp(
            prefix="ashley-e1-root-")
        probe.bootstrap_from_module_path = lambda *args, **kwargs: events.append(
            "bootstrap")

        probe.initialize_probe()
        probe.initialize_probe()

        self.assertEqual(events, ["bootstrap"])
        self.assertTrue(probe._INITIALIZED)

    def test_bootstrap_emits_required_import_summary(self):
        load_probe()
        from ashley_e1 import schema, writer
        summary = {key: True for key in schema.REQUIRED_IMPORT_KEYS}
        with tempfile.TemporaryDirectory() as temp:
            module_path = os.path.join(temp, "The Sims 4", "Mods", "AshleyE1",
                                       "ashley_e1", "writer.py")
            root = writer.bootstrap_from_module_path(
                module_path, "1.0.7", "1.128.90.1030", summary)
            files = [name for name in os.listdir(root) if name.startswith("ashley_e1_bootstrap_")]
            self.assertEqual(len(files), 1)
            with open(os.path.join(root, files[0]), "r", encoding="utf-8") as handle:
                row = json.loads(handle.readline())
            self.assertEqual(row["runtime"]["required_imports"], summary)
            self.assertEqual(row["attestation"]["armed_name"], "UNARMED")
            self.assertIsNone(row["telemetry_session_id"])
            for forbidden in ("save", "zone", "body", "interactions", "motives", "sim_signals"):
                self.assertNotIn(forbidden, row)


if __name__ == "__main__":
    unittest.main()

# End of bootstrap tests.
