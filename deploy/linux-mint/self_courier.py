# Publish exact sealed proposals to an Owner-authorized private review repository; never apply to live Ashley.
import datetime
import hashlib
import json
import os
import pathlib
import re
import shlex
import subprocess
import tempfile

PUBLIC_REMOTE = "https://github.com/XharvaK/Ashley.git"
SELF_REMOTE = "git@github.com:XharvaK/Ashley-self.git"
OID = re.compile(r"(?:[a-f0-9]{40}|[a-f0-9]{64})\Z")
SHA256 = re.compile(r"[a-f0-9]{64}\Z")
CHANGESET = re.compile(r"cs_[A-Za-z0-9_-]+\Z")

class CourierError(RuntimeError):
    pass

class GitRunner:
    def __init__(self, executable="/usr/bin/git", ssh_command=None):
        self.executable = executable
        self.environment = {key: os.environ[key] for key in ("PATH", "SystemRoot", "WINDIR", "TEMP", "TMP") if key in os.environ}
        self.environment.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL="NUL" if os.name == "nt" else "/dev/null",
            GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0", GIT_ATTR_NOSYSTEM="1")
        if ssh_command:
            self.environment["GIT_SSH_COMMAND"] = ssh_command

    def run(self, args, cwd, check=True, input=None):
        null = "NUL" if os.name == "nt" else "/dev/null"
        result = subprocess.run([self.executable, "-c", "core.hooksPath="+null, "-c", "core.fsmonitor=false",
            "-c", "commit.gpgsign=false", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always",
            "-c", "protocol.ssh.allow=always", *args], cwd=cwd, env=self.environment, input=input,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        if check and result.returncode:
            # Never log transport stderr, key paths, candidate text or command interpolation.
            raise CourierError("git_operation_failed")
        return result

def text(git, args, cwd):
    return git.run(args, cwd).stdout.decode("utf-8").strip()

def regular(path):
    if path.is_symlink() or not path.is_file():
        raise CourierError("artifact_path_invalid")

def bounded_bytes(path, maximum):
    regular(path)
    if path.stat().st_size > maximum:
        raise CourierError("artifact_too_large")
    with path.open("rb") as handle:
        result = handle.read(maximum+1)
    if len(result) > maximum:
        raise CourierError("artifact_too_large")
    return result

def pair(export_root, manifest_path, project_id):
    raw = bounded_bytes(manifest_path, 16*1024)
    try:
        m = json.loads(raw)
        cid = m["changesetId"]
        receipt = m["m4Receipt"]
        valid = (m["version"] == 1 and m["projectId"] == project_id and isinstance(cid, str) and CHANGESET.fullmatch(cid)
            and manifest_path.name == cid+".manifest.json"
            and all(isinstance(m[key], str) and OID.fullmatch(m[key]) for key in ("baseCommit", "baseTree", "sanitizedBaseTree", "candidateTree"))
            and isinstance(m["rationale"], str) and 0 < len(m["rationale"].strip()) <= 4000
            and isinstance(m["patchSha256"], str) and SHA256.fullmatch(m["patchSha256"])
            and isinstance(m["candidateContentHash"], str) and SHA256.fullmatch(m["candidateContentHash"])
            and isinstance(m["frictionRefs"], list) and len(m["frictionRefs"]) <= 8
            and all(isinstance(ref, str) and ref.startswith("friction:") and len(ref) > 9 for ref in m["frictionRefs"])
            and receipt["outcome"] == "succeeded" and receipt["verificationOutcome"] == "verified_success"
            and receipt["candidateTreeHash"] == m["candidateContentHash"]
            and isinstance(receipt["taskId"], str) and bool(receipt["taskId"])
            and isinstance(receipt["workspaceId"], str) and bool(receipt["workspaceId"]))
    except (ValueError, KeyError, TypeError):
        valid = False
    if not valid:
        raise CourierError("manifest_binding_invalid")
    patch = bounded_bytes(export_root / (cid+".patch"), 256*1024)
    if hashlib.sha256(patch).hexdigest() != m["patchSha256"]:
        raise CourierError("patch_digest_mismatch")
    return m, patch, hashlib.sha256(raw).hexdigest()

def remote_ref(git, repo, ref):
    result = text(git, ["ls-remote", "--refs", "origin", ref], repo)
    if not result:
        return None
    lines = result.splitlines()
    if len(lines) != 1:
        raise CourierError("remote_ref_ambiguous")
    fields = lines[0].split()
    if len(fields) != 2 or fields[1] != ref or not OID.fullmatch(fields[0]):
        raise CourierError("remote_ref_invalid")
    return fields[0]

def mirror_main(git, repo):
    git.run(["fetch", "--no-tags", PUBLIC_REMOTE, "refs/heads/main"], repo)
    public = text(git, ["rev-parse", "FETCH_HEAD^{commit}"], repo)
    current = remote_ref(git, repo, "refs/heads/main")
    if current:
        git.run(["fetch", "--no-tags", "origin", "refs/heads/main"], repo)
        if text(git, ["rev-parse", "FETCH_HEAD^{commit}"], repo) != current:
            raise CourierError("main_changed")
        ancestor = git.run(["merge-base", "--is-ancestor", current, public], repo, check=False)
        if ancestor.returncode:
            raise CourierError("main_diverged")
    if current != public:
        git.run(["push", "origin", public+":refs/heads/main"], repo)
    if remote_ref(git, repo, "refs/heads/main") != public:
        raise CourierError("main_witness_mismatch")
    return public

def publish(git, repo, session, public, m, patch, manifest_sha):
    cid = m["changesetId"]
    base = m["baseCommit"]
    # An exact SHA fetch, never a shallow-history assumption or live-HEAD fallback.
    git.run(["fetch", "--no-tags", "origin", base], repo)
    if text(git, ["rev-parse", "FETCH_HEAD^{commit}"], repo) != base:
        raise CourierError("base_unreachable")
    if text(git, ["rev-parse", base+"^{tree}"], repo) != m["baseTree"]:
        raise CourierError("base_tree_mismatch")
    if git.run(["merge-base", "--is-ancestor", base, public], repo, check=False).returncode:
        raise CourierError("base_not_on_main")
    git.run(["checkout", "--detach", base], repo)
    patch_file = session / "sealed.patch"
    patch_file.write_bytes(patch)
    git.run(["apply", "--check", str(patch_file)], repo)
    git.run(["apply", str(patch_file)], repo)
    git.run(["add", "--all"], repo)
    candidate_tree = text(git, ["write-tree"], repo)
    if candidate_tree == m["baseTree"]:
        raise CourierError("empty_patch")
    if m["sanitizedBaseTree"] == m["baseTree"] and candidate_tree != m["candidateTree"]:
        raise CourierError("candidate_tree_mismatch")
    proposal = {key: m[key] for key in ("changesetId", "baseCommit", "baseTree", "sanitizedBaseTree", "candidateTree",
        "candidateContentHash", "rationale", "frictionRefs", "patchSha256")}
    proposal.update(manifestSha256=manifest_sha, m4Receipt=m["m4Receipt"], actualRepositoryTree=candidate_tree)
    message = "Self-change proposal "+cid+"\n\n"+json.dumps(proposal, ensure_ascii=False, sort_keys=True)+"\n"
    ref = "refs/heads/self/"+cid
    existing = remote_ref(git, repo, ref)
    if existing:
        git.run(["fetch", "--no-tags", "origin", ref], repo)
        if (text(git, ["rev-parse", "FETCH_HEAD^{commit}"], repo) != existing
            or text(git, ["rev-parse", existing+"^"], repo) != base
            or text(git, ["rev-parse", existing+"^{tree}"], repo) != candidate_tree
            or text(git, ["show", "-s", "--format=%B", existing], repo) != message.strip()):
            raise CourierError("self_branch_conflict")
        commit, outcome = existing, "existing_verified"
    else:
        git.run(["-c", "user.name=XharvaK", "-c", "user.email=278531296+XharvaK@users.noreply.github.com",
            "commit", "-F", "-"], repo, input=message.encode("utf-8"))
        commit = text(git, ["rev-parse", "HEAD"], repo)
        git.run(["push", "origin", commit+":"+ref], repo)
        if remote_ref(git, repo, ref) != commit:
            raise CourierError("publication_witness_mismatch")
        outcome = "published"
    return {"changesetId": cid, "manifestSha256": manifest_sha, "patchSha256": m["patchSha256"], "baseCommit": base,
        "declaredCandidateTree": m["candidateTree"], "actualRepositoryTree": candidate_tree, "branch": "self/"+cid,
        "commit": commit, "outcome": outcome, "dataClassification": "never_public", "appliedToLiveAshley": False}

def run_once(export_root, state_root, project_id, git, on_receipt=None):
    export_root, state_root = pathlib.Path(export_root), pathlib.Path(state_root)
    if export_root.is_symlink() or state_root.is_symlink() or not export_root.is_dir() or not state_root.is_dir():
        raise CourierError("courier_root_invalid")
    if export_root.resolve() == state_root.resolve():
        raise CourierError("courier_root_overlap")
    pairs = [pair(export_root, path, project_id) for path in sorted(export_root.glob("*.manifest.json"))]
    if not pairs:
        return []
    receipts = []
    for m, patch, manifest_sha in pairs:
        with tempfile.TemporaryDirectory(prefix="proposal-", dir=state_root) as directory:
            session = pathlib.Path(directory).resolve()
            session.relative_to(state_root.resolve())  # Controller-created cleanup target stays within its explicit state root.
            repo = session / "repo"
            git.run(["clone", "--no-checkout", SELF_REMOTE, str(repo)], session)
            (repo / ".git" / "info" / "attributes").write_text("* -text -filter -ident -working-tree-encoding\n", encoding="utf-8")
            public = mirror_main(git, repo)
            receipt = publish(git, repo, session, public, m, patch, manifest_sha)
            receipt["observedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            if on_receipt:
                on_receipt(receipt)
            receipts.append(receipt)
    return receipts

def main():
    if os.environ.get("ASHLEY_SELF_COURIER_ENABLED") != "true":
        print("self_courier_disabled")
        return 0
    if os.name != "posix":
        raise CourierError("courier_platform_unsupported")
    import fcntl
    required = ("ASHLEY_SELF_COURIER_EXPORT_ROOT", "ASHLEY_SELF_COURIER_PROJECT_ID", "ASHLEY_SELF_COURIER_KEY_FILE", "ASHLEY_SELF_COURIER_KNOWN_HOSTS_FILE")
    if any(not os.environ.get(key) for key in required):
        raise CourierError("courier_owner_configuration_required")
    key = pathlib.Path(os.environ[required[2]])
    hosts = pathlib.Path(os.environ[required[3]])
    regular(key); regular(hosts)
    if not key.is_absolute() or not hosts.is_absolute() or key.stat().st_mode & 0o077:
        raise CourierError("courier_key_configuration_invalid")
    data = pathlib.Path.home() / ".composer-assistant" / "self-change"
    state = data / "courier-state"
    if any(path.is_symlink() for path in (data.parent, data, state)):
        raise CourierError("courier_root_invalid")
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = data / "courier.lock"
    journal = data / "courier.jsonl"
    if lock.is_symlink() or journal.is_symlink():
        raise CourierError("courier_control_path_invalid")
    ssh = "/usr/bin/ssh -F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="+shlex.quote(str(hosts))+" -i "+shlex.quote(str(key))
    with lock.open("a", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def record(receipt):
            # Each witnessed publication is durable before the next proposal; retry verifies existing branches.
            with journal.open("a", encoding="utf-8") as output:
                os.chmod(journal, 0o600)
                output.write(json.dumps(receipt, sort_keys=True)+"\n")
                output.flush(); os.fsync(output.fileno())
        receipts = run_once(pathlib.Path(os.environ[required[0]]), state, os.environ[required[1]], GitRunner(ssh_command=ssh), record)
    print("self_courier_complete", len(receipts))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CourierError as error:
        print(str(error))
        raise SystemExit(1)
    except Exception:
        print("self_courier_outcome_unknown")
        raise SystemExit(1)
