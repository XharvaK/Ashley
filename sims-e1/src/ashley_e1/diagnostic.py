"""Small, synchronous command-dispatch diagnostic writer."""

import json
import os
import sys
import time


DIAGNOSTIC_VERSION = "1.0.4"
DIAGNOSTIC_FILENAME = "ashley_e1_command_dispatch_diag_1.0.4.jsonl"
MAX_REPR_LENGTH = 120
MAX_ITEMS = 16
MAX_ROW_BYTES = 4096


def _bounded_text(value, limit=MAX_REPR_LENGTH):
    try:
        text = value if isinstance(value, str) else str(value)
    except BaseException:
        text = "<text_error>"
    if len(text) <= limit:
        return text
    return text[:max(0, limit - 3)] + "..."


def bounded_repr(value):
    try:
        text = repr(value)
    except BaseException:
        text = "<repr_error>"
    return _bounded_text(text)


def type_name(value):
    try:
        return _bounded_text(type(value).__name__)
    except BaseException:
        return "<type_error>"


def _timestamp_ms():
    return int(time.time() * 1000)


def _write_row(root, row):
    if not isinstance(root, str) or not root:
        return False
    try:
        payload = json.dumps(row, ensure_ascii=True, separators=(",", ":"))
        encoded = payload.encode("utf-8")
        if len(encoded) > MAX_ROW_BYTES:
            payload = json.dumps({
                "diagnostic_version": DIAGNOSTIC_VERSION,
                "diagnostic_kind": row.get("diagnostic_kind", "unknown"),
                "wall_timestamp_ms": _timestamp_ms(),
                "truncated": True,
            }, ensure_ascii=True, separators=(",", ":"))
        os.makedirs(root, exist_ok=True)
        path = os.path.join(root, DIAGNOSTIC_FILENAME)
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(payload + "\n")
            handle.flush()
        return True
    except (OSError, IOError, TypeError, ValueError):
        return False


def _safe_attribute(module, name):
    try:
        present = hasattr(module, name)
    except BaseException:
        return False, None
    if not present:
        return False, None
    try:
        return True, getattr(module, name)
    except BaseException:
        return True, None


def write_bootstrap(root, commands_module, register, command):
    has_bridge, bridge_value = _safe_attribute(
        commands_module, "__enable_native_commands")
    bridge_enabled = bridge_value if has_bridge and type(bridge_value) is bool else None
    has_native_commands, native_commands = _safe_attribute(commands_module, "_commands")
    modules_entry = sys.modules.get("_commands")
    row = {
        "diagnostic_version": DIAGNOSTIC_VERSION,
        "diagnostic_kind": "bootstrap",
        "wall_timestamp_ms": _timestamp_ms(),
        "native_bridge_attribute_present": has_bridge,
        "native_bridge_enabled": bridge_enabled,
        "native_commands_attribute_present": has_native_commands,
        "native_commands_type": type_name(native_commands) if has_native_commands else None,
        "native_commands_in_sys_modules": "_commands" in sys.modules,
        "sys_modules_native_commands_type": type_name(modules_entry) if modules_entry is not None else None,
        "register_callable": callable(register),
        "command_callable": callable(command),
    }
    return _write_row(root, row)


def _bounded_items(values, include_value):
    items = []
    for index, value in enumerate(values[:MAX_ITEMS]):
        item = {"index": index, "type": type_name(value)}
        if include_value:
            item["repr"] = bounded_repr(value)
        items.append(item)
    return items


def write_raw(root, args, kwargs, session_id):
    names = sorted(kwargs)
    bounded_names = [_bounded_text(name) for name in names[:MAX_ITEMS]]
    keyword_items = []
    for name in names[:MAX_ITEMS]:
        value = kwargs[name]
        keyword_items.append({
            "key": _bounded_text(name),
            "type": type_name(value),
            "repr": bounded_repr(value),
        })
    row = {
        "diagnostic_version": DIAGNOSTIC_VERSION,
        "diagnostic_kind": "raw_dispatch",
        "command": "ashley_e1.diag_raw",
        "wall_timestamp_ms": _timestamp_ms(),
        "positional_count": len(args),
        "positional": _bounded_items(args, True),
        "positional_omitted": max(0, len(args) - MAX_ITEMS),
        "keyword_count": len(kwargs),
        "keyword_names": bounded_names,
        "keyword_names_omitted": max(0, len(names) - MAX_ITEMS),
        "keywords": keyword_items,
        "session_id": {"type": type_name(session_id),
                       "repr": bounded_repr(session_id)},
    }
    return _write_row(root, row)


def write_wrapped(root, connection, account):
    row = {
        "diagnostic_version": DIAGNOSTIC_VERSION,
        "diagnostic_kind": "wrapped_dispatch",
        "command": "ashley_e1.diag_wrapped",
        "wall_timestamp_ms": _timestamp_ms(),
        "connection": {"type": type_name(connection),
                        "repr": bounded_repr(connection)},
        "account": {"type": type_name(account),
                     "repr": bounded_repr(account)},
    }
    return _write_row(root, row)
