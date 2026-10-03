# Verify courier publication against isolated local Git repositories; no network, credentials, or live checkout.
import importlib.util
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest

HERE = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("self_courier", HERE / "self_courier.py")
port = None
if spec and (HERE / "self_courier.py").exists():
    port = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(port)

class CourierTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(port and callable(getattr(port, "run_once", None)), "courier mechanism exists")
        self.temp = tempfile.TemporaryDirectory(prefix="ashley-s2-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name).resolve()
        self.source = self.root / "source"; self.source.mkdir()
        self.exports = self.root / "exports"; self.exports.mkdir()
        self.state = self.root / "state"; self.state.mkdir()
        self.public = self.root / "public.git"; self.private = self.root / "private.git"
        self.git(["init", "-b", "main"], self.source)
        (self.source / "file.txt").write_bytes(b"before\n")
        self.git(["add", "."], self.source)
        self.git(["-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-m", "base"], self.source)
        self.base = self.git(["rev-parse", "HEAD"], self.source).strip()
        self.tree = self.git(["rev-parse", "HEAD^{tree}"], self.source).strip()
        (self.source / "file.txt").write_bytes(b"after\n")
        self.patch = subprocess.check_output([shutil.which("git"), "diff", "--binary", "HEAD"], cwd=self.source)
        self.git(["add", "."], self.source)
        candidate = self.git(["write-tree"], self.source).strip()
        self.git(["clone", "--bare", str(self.source), str(self.public)], self.root)
        self.git(["init", "--bare", str(self.private)], self.root)
        self.manifest = {"version": 1, "projectId": "project", "changesetId": "cs_fixture", "baseCommit": self.base,
            "baseTree": self.tree, "sanitizedBaseTree": self.tree, "candidateTree": candidate,
            "candidateContentHash": "a"*64, "rationale": "Thought's authored repair", "frictionRefs": ["friction:declared"],
            "m4Receipt": {"taskId": "actual-fixture-receipt", "workspaceId": "fixture", "outcome": "succeeded", "verificationOutcome": "verified_success", "candidateTreeHash": "a"*64},
            "patchSha256": hashlib.sha256(self.patch).hexdigest()}
        self.write_pair()
        self.runner = port.GitRunner(executable=shutil.which("git"))
        original = self.runner.run
        def offline(args, cwd, **kwargs):
            mapped = [str(self.public) if arg == port.PUBLIC_REMOTE else str(self.private) if arg == port.SELF_REMOTE else arg for arg in args]
            return original(["-c", "protocol.file.allow=always", *mapped], cwd, **kwargs)
        self.runner.run = offline

    def git(self, args, cwd):
        return subprocess.check_output([shutil.which("git"), "-c", "commit.gpgsign=false", *args], cwd=cwd, stderr=subprocess.PIPE).decode("utf-8")

    def write_pair(self):
        (self.exports / "cs_fixture.patch").write_bytes(self.patch)
        (self.exports / "cs_fixture.manifest.json").write_text(json.dumps(self.manifest)+"\n", encoding="utf-8")

    def run_courier(self):
        return port.run_once(self.exports, self.state, "project", self.runner)

    def test_actual_fetch_apply_commit_push_and_repeat(self):
        first = self.run_courier()
        commit = self.git(["rev-parse", "refs/heads/self/cs_fixture"], self.private).strip()
        self.assertEqual(self.git(["show", f"{commit}:file.txt"], self.private), "after\n")
        self.assertEqual(self.git(["rev-parse", f"{commit}^"], self.private).strip(), self.base)
        self.assertEqual(self.git(["rev-parse", "refs/heads/main"], self.private).strip(), self.base)
        self.assertEqual(first[0]["outcome"], "published")
        self.assertEqual(self.run_courier()[0]["outcome"], "existing_verified")
        self.assertEqual(self.git(["rev-parse", "refs/heads/self/cs_fixture"], self.private).strip(), commit)
        self.assertIn("Thought's authored repair", self.git(["show", "-s", "--format=%B", commit], self.private))

    def test_digest_mismatch_refuses_before_remote_mutation(self):
        (self.exports / "cs_fixture.patch").write_bytes(b"different")
        with self.assertRaisesRegex(port.CourierError, "patch_digest_mismatch"):
            self.run_courier()
        self.assertEqual(self.git(["for-each-ref", "--format=%(refname)"], self.private), "")

    def test_existing_branch_with_different_manifest_never_overwrites(self):
        self.run_courier()
        previous = self.git(["rev-parse", "refs/heads/self/cs_fixture"], self.private).strip()
        self.manifest["rationale"] = "changed rationale"; self.write_pair()
        with self.assertRaisesRegex(port.CourierError, "self_branch_conflict"):
            self.run_courier()
        self.assertEqual(self.git(["rev-parse", "refs/heads/self/cs_fixture"], self.private).strip(), previous)

    def test_partial_batch_records_success_before_later_failure_and_retry(self):
        second = dict(self.manifest, changesetId="cs_zlater", baseTree="b"*40)
        (self.exports / "cs_zlater.patch").write_bytes(self.patch)
        (self.exports / "cs_zlater.manifest.json").write_text(json.dumps(second))
        recorded = []
        with self.assertRaisesRegex(port.CourierError, "base_tree_mismatch"):
            port.run_once(self.exports, self.state, "project", self.runner, recorded.append)
        self.assertEqual(len(recorded), 1)
        self.assertEqual(recorded[0]["outcome"], "published")
        self.assertIn("observedAt", recorded[0])
        recovered = []
        with self.assertRaisesRegex(port.CourierError, "base_tree_mismatch"):
            port.run_once(self.exports, self.state, "project", self.runner, recovered.append)
        self.assertEqual(recovered[0]["commit"], recorded[0]["commit"])
        self.assertEqual(recovered[0]["outcome"], "existing_verified")

    def test_private_main_ahead_of_public_refuses_without_rewind(self):
        self.run_courier()
        clone = self.root / "divergent"
        self.git(["clone", str(self.private), str(clone)], self.root)
        self.git(["checkout", "main"], clone)
        (clone / "operator.txt").write_text("private change")
        self.git(["add", "."], clone)
        self.git(["-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-m", "private"], clone)
        self.git(["push", "origin", "main"], clone)
        previous = self.git(["rev-parse", "main"], self.private).strip()
        with self.assertRaisesRegex(port.CourierError, "main_diverged"):
            self.run_courier()
        self.assertEqual(self.git(["rev-parse", "main"], self.private).strip(), previous)

    def test_unverified_receipt_refuses_before_remote_mutation(self):
        self.manifest["m4Receipt"]["verificationOutcome"] = "verified_failure"; self.write_pair()
        with self.assertRaisesRegex(port.CourierError, "manifest_binding_invalid"):
            self.run_courier()
        self.assertEqual(self.git(["for-each-ref", "--format=%(refname)"], self.private), "")

if __name__ == "__main__":
    unittest.main()
