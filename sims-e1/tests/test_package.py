import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
import zipfile


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SPEC = importlib.util.spec_from_file_location(
    "e1_check_guards", os.path.join(ROOT, "tools", "check_guards.py")
)
checks = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checks)


MAGIC_370 = bytes.fromhex("420d0d0a")


class PackageContractTests(unittest.TestCase):
    def make_archive(self, path, members):
        with zipfile.ZipFile(path, "w") as archive:
            for name, content in members.items():
                archive.writestr(name, content)

    def test_valid_pyc_only_archive_passes(self):
        with tempfile.TemporaryDirectory() as temp:
            path = os.path.join(temp, "probe.ts4script")
            members = {"ashley_e1/%s.pyc" % name: MAGIC_370 + b"payload"
                       for name in checks.PRODUCTION_MODULES}
            self.make_archive(path, members)
            self.assertEqual(checks.inspect_archive(path, MAGIC_370), [])

    def test_wrong_magic_raw_source_and_cache_layout_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            for name, members in (
                ("magic", {"ashley_e1/__init__.pyc": b"bad!payload"}),
                ("source", {"ashley_e1/__init__.py": b"raw"}),
                ("cache", {"ashley_e1/__pycache__/__init__.cpython-37.pyc": MAGIC_370 + b"x"}),
            ):
                path = os.path.join(temp, name + ".ts4script")
                self.make_archive(path, members)
                self.assertTrue(checks.inspect_archive(path, MAGIC_370), name)

    def test_manifest_artifact_hash_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            path = os.path.join(temp, "probe.ts4script")
            self.make_archive(path, {"ashley_e1/__init__.pyc": MAGIC_370 + b"x"})
            manifest = {"artifact": {"sha256": "0" * 64}}
            self.assertTrue(checks.verify_artifact_manifest(path, manifest))
            with open(path, "rb") as handle:
                manifest["artifact"]["sha256"] = hashlib.sha256(handle.read()).hexdigest().upper()
            self.assertEqual(checks.verify_artifact_manifest(path, manifest), [])


if __name__ == "__main__":
    unittest.main()
