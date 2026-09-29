"""AST-only shipped-source and artifact checks for the E1 build."""

import ast
import hashlib
import os
import zipfile


APPROVED_STDLIB_IMPORTS = {
    "hashlib", "json", "os", "pathlib", "queue", "struct", "sys",
    "threading", "time", "uuid",
}
APPROVED_GAME_ROOTS = {
    "alarms", "clock", "date_and_time", "interactions", "objects",
    "scheduling", "server", "services", "sims", "sims4",
}
FORBIDDEN_IMPORT_ROOTS = {
    "http", "importlib", "s4cl", "shm", "socket", "ssl", "subprocess", "urllib",
}
FORBIDDEN_CALL_NAMES = {
    "__import__", "add_buff", "add_selectable_sim_info", "advance_current_time",
    "cancel", "compile", "destroy", "disable_autonomy", "enable_autonomy",
    "eval", "exec", "execute", "inject_safely_into", "pause_the_game",
    "push_super_affordance", "remove_buff", "remove_selectable_sim_info", "reset",
    "save_game_gen", "save_using", "set_active_sim", "set_clock_speed",
    "set_current_time", "system", "test_and_execute",
}
DIAGNOSTIC_FILE_NAMES = {"diagnostic.py"}


def _root(name):
    return name.split(".", 1)[0]


def scan_text(source, filename):
    findings = []
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError as error:
        return ["%s:%s syntax error: %s" % (filename, error.lineno, error.msg)]
    aliases = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for item in node.names:
                root = _root(item.name)
                if root in FORBIDDEN_IMPORT_ROOTS:
                    findings.append("%s:%d forbidden import %s" % (filename, node.lineno, item.name))
                if root not in APPROVED_STDLIB_IMPORTS and root not in APPROVED_GAME_ROOTS:
                    findings.append("%s:%d unapproved import %s" % (filename, node.lineno, item.name))
                if (os.path.basename(filename).lower() == "writer.py" and
                        root in APPROVED_GAME_ROOTS):
                    findings.append("%s:%d writer imports game module %s" %
                                    (filename, node.lineno, item.name))
                aliases[item.asname or root] = item.name
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if node.level:
                continue
            root = _root(module)
            if root in FORBIDDEN_IMPORT_ROOTS:
                findings.append("%s:%d forbidden import %s" % (filename, node.lineno, module))
            if root not in APPROVED_STDLIB_IMPORTS and root not in APPROVED_GAME_ROOTS:
                findings.append("%s:%d unapproved import %s" % (filename, node.lineno, module))
            if (os.path.basename(filename).lower() == "writer.py" and
                    root in APPROVED_GAME_ROOTS):
                findings.append("%s:%d writer imports game module %s" %
                                (filename, node.lineno, module))
            for item in node.names:
                aliases[item.asname or item.name] = (module + "." + item.name).strip(".")
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
        else:
            continue
        resolved = _resolve_expr(node.value, aliases) if getattr(node, "value", None) is not None else None
        if resolved is None:
            continue
        for target_node in targets:
            if isinstance(target_node, ast.Name):
                aliases[target_node.id] = resolved
            elif isinstance(target_node, (ast.Tuple, ast.List)):
                for child in target_node.elts:
                    if isinstance(child, ast.Name):
                        aliases[child.id] = resolved
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        target = _call_target(node.func)
        resolved_target = _resolve_expr(node.func, aliases) or target
        leaf = resolved_target.rsplit(".", 1)[-1] if resolved_target else ""
        if leaf in FORBIDDEN_CALL_NAMES:
            findings.append("%s:%d forbidden call %s" % (filename, node.lineno, resolved_target or leaf))
        if resolved_target in ("eval", "exec", "compile", "__import__"):
            findings.append("%s:%d dynamic execution %s" % (filename, node.lineno, resolved_target))
        if ((leaf == "getattr" or leaf == "__import__") and
                os.path.basename(filename).lower() not in DIAGNOSTIC_FILE_NAMES):
            findings.append("%s:%d reflective dispatch" % (filename, node.lineno))
        if (leaf == "open" and
                os.path.basename(filename).lower() not in
                ({"writer.py"} | DIAGNOSTIC_FILE_NAMES)):
            findings.append("%s:%d open outside writer" % (filename, node.lineno))
    return findings


def _call_target(function):
    if isinstance(function, ast.Name):
        return function.id
    parts = []
    current = function
    while isinstance(current, ast.Attribute):
        parts.append(current.attr)
        current = current.value
    if isinstance(current, ast.Name):
        parts.append(current.id)
        return ".".join(reversed(parts))
    return None


def _resolve_expr(expression, aliases):
    """Resolve imported and locally assigned call aliases conservatively."""
    target = _call_target(expression)
    if target is None:
        return None
    parts = target.split(".")
    seen = set()
    while parts and parts[0] in aliases and parts[0] not in seen:
        seen.add(parts[0])
        replacement = aliases[parts[0]].split(".")
        parts = replacement + parts[1:]
    return ".".join(parts)


def scan_tree(source_root):
    findings = []
    for root, _, names in os.walk(source_root):
        for name in sorted(names):
            if not name.endswith(".py"):
                continue
            path = os.path.join(root, name)
            with open(path, "r", encoding="utf-8") as handle:
                findings.extend(scan_text(handle.read(), path))
    return findings


def inspect_archive(path, expected_magic):
    findings = []
    required = {
        "ashley_e1/__init__.pyc", "ashley_e1/probe.pyc", "ashley_e1/observers.pyc",
        "ashley_e1/snapshot.pyc", "ashley_e1/schema.pyc", "ashley_e1/writer.pyc",
    }
    try:
        with zipfile.ZipFile(path, "r") as archive:
            names = set(archive.namelist())
            missing = sorted(required - names)
            if missing:
                findings.append("missing members: %s" % ", ".join(missing))
            for name in names:
                if name.endswith(".py") or "__pycache__" in name or name.endswith(".pyo"):
                    findings.append("forbidden archive member: %s" % name)
                if name.endswith(".pyc") and archive.read(name)[:4] != expected_magic:
                    findings.append("wrong pyc magic: %s" % name)
    except (OSError, IOError, zipfile.BadZipFile) as error:
        findings.append("archive unreadable: %s" % error)
    return findings


def verify_artifact_manifest(path, manifest):
    expected = manifest.get("artifact", {}).get("sha256")
    with open(path, "rb") as handle:
        actual = hashlib.sha256(handle.read()).hexdigest().upper()
    return [] if expected == actual else ["artifact sha256 mismatch"]


if __name__ == "__main__":
    import sys
    errors = scan_tree(sys.argv[1]) if len(sys.argv) > 1 else []
    for error in errors:
        print(error)
    raise SystemExit(1 if errors else 0)
