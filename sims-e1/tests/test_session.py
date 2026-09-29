import os
import sys
import unittest

from test_binding import FakeWriter, load_probe


class SessionTests(unittest.TestCase):
    def test_fresh_uuid_per_arm_and_no_automatic_reload_reset(self):
        _, probe, _ = load_probe()
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        first = probe.get_status()["telemetry_session_id"]
        self.assertTrue(probe._cmd_disarm())
        self.assertFalse(probe._cmd_arm("LAB_E1"))
        FakeWriter.instances[-1].finish()
        self.assertTrue(probe.get_status()["writer_idle"])
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        second = probe.get_status()["telemetry_session_id"]
        self.assertNotEqual(first, second)

    def test_arm_disarm_without_start_uses_armed_never_started(self):
        _, probe, _ = load_probe()
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        writer = FakeWriter.instances[-1]
        self.assertTrue(probe._cmd_disarm())
        self.assertEqual(writer.close_reason, "ARMED_NEVER_STARTED")

    def test_explicit_disarm_is_the_only_close_boundary(self):
        _, probe, _ = load_probe()
        self.assertTrue(probe._cmd_arm("LAB_E1"))
        writer = FakeWriter.instances[-1]
        self.assertIsNone(writer.close_reason)
        self.assertEqual(probe.get_status()["state"], "ARMED")
        self.assertTrue(probe._cmd_disarm())
        self.assertEqual(writer.close_reason, "ARMED_NEVER_STARTED")


if __name__ == "__main__":
    unittest.main()
