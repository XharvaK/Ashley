import importlib.util
import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TOOLS = os.path.join(ROOT, "tools")
SPEC = importlib.util.spec_from_file_location("e1_check_guards", os.path.join(TOOLS, "check_guards.py"))
guards = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guards)


class StaticGuardTests(unittest.TestCase):
    def test_comments_strings_and_harmless_names_pass(self):
        source = '''\n"""push_super_affordance save_using native_autonomy"""\nautonomy_setting = 1\ntext = "set_active_sim"\n'''
        self.assertEqual(guards.scan_text(source, "probe.py"), [])

    def test_actual_forbidden_calls_fail_alias_aware(self):
        cases = (
            "import sims.sim as _s\n_s.push_super_affordance()\n",
            "from sims.sim import push_super_affordance as p\np()\n",
            "import services as svc\nsvc.set_active_sim()\n",
        )
        for source in cases:
            with self.subTest(source=source):
                findings = guards.scan_text(source, "probe.py")
                self.assertTrue(findings)

    def test_dynamic_execution_and_unapproved_imports_fail(self):
        for source in ("eval('1')", "__import__('services')", "import socket"):
            with self.subTest(source=source):
                self.assertTrue(guards.scan_text(source, "probe.py"))

    def test_assigned_alias_and_assigned_reflection_fail(self):
        for source in (
            "import services as svc\nf = svc.set_active_sim\nf()\n",
            "import services as svc\ng = getattr\ng(svc, 'set_active_sim')\n",
        ):
            with self.subTest(source=source):
                self.assertTrue(guards.scan_text(source, "probe.py"))

    def test_open_outside_writer_and_game_import_inside_writer_fail(self):
        self.assertTrue(guards.scan_text("open('x')", "probe.py"))
        self.assertEqual(guards.scan_text("open('x')", "writer.py"), [])
        self.assertTrue(guards.scan_text("import services", "writer.py"))

    def test_shipped_source_tree_passes(self):
        findings = guards.scan_tree(os.path.join(ROOT, "src"))
        self.assertEqual(findings, [])


if __name__ == "__main__":
    unittest.main()
