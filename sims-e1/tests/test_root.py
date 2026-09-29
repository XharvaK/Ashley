import os
import sys
import tempfile
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


class RootDerivationTests(unittest.TestCase):
    def test_component_safe_mods_ashley_pair_derives_root(self):
        path = os.path.join("C:\\Users\\Owner", "Documents", "Electronic Arts", "The Sims 4",
                            "Mods", "AshleyE1", "ashley_e1", "writer.pyc")
        root = writer.derive_telemetry_root(path)
        self.assertEqual(
            os.path.normcase(root),
            os.path.normcase(os.path.join("C:\\Users\\Owner", "Documents", "Electronic Arts", "The Sims 4",
                                          "AshleyE1Telemetry")),
        )

    def test_textual_mods_substrings_do_not_derive(self):
        for path in (
            os.path.join("C:\\tmp", "MyModsBackup", "AshleyE1", "writer.pyc"),
            os.path.join("C:\\tmp", "ModsStuff", "AshleyE1", "writer.pyc"),
            os.path.join("C:\\tmp", "Mods", "Other", "AshleyE1", "writer.pyc"),
        ):
            self.assertIsNone(writer.derive_telemetry_root(path))

    def test_failed_derivation_performs_no_writes(self):
        with tempfile.TemporaryDirectory() as temp:
            before = list(os.walk(temp))
            self.assertIsNone(writer.bootstrap_from_module_path(
                os.path.join(temp, "src", "ashley_e1", "writer.py"),
                "1.0.6", "1.128.90.1030",
                {key: True for key in schema.REQUIRED_IMPORT_KEYS},
            ))
            self.assertEqual(before, list(os.walk(temp)))


if __name__ == "__main__":
    unittest.main()
