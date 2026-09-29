import importlib
import os
import sys
import unittest

from test_binding import load_probe


class BootstrapTests(unittest.TestCase):
    def test_package_initializes_once_and_secondary_imports_are_pure(self):
        package, probe, calls = load_probe()
        self.assertEqual(len(calls["registrations"]), 4)
        probe.initialize_probe()
        self.assertEqual(len(calls["registrations"]), 4)
        self.assertEqual(len(calls["alarms"]), 0)
        for name in ("observers", "snapshot", "schema", "writer"):
            importlib.import_module("ashley_e1." + name)
        self.assertEqual(len(calls["registrations"]), 4)
        self.assertEqual(len(calls["alarms"]), 0)

    def test_no_alarm_exists_before_explicit_start(self):
        _, probe, calls = load_probe()
        self.assertEqual(calls["alarms"], [])
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        self.assertEqual(calls["alarms"], [])
        self.assertTrue(probe._cmd_start())
        self.assertEqual(len(calls["alarms"]), 1)


if __name__ == "__main__":
    unittest.main()

# End of bootstrap tests.
