"""Verification-only policy tables for the Ashley E1 shipped source."""

APPROVED_STDLIB_IMPORTS = {
    "hashlib",
    "json",
    "os",
    "pathlib",
    "queue",
    "struct",
    "sys",
    "threading",
    "time",
    "uuid",
}

APPROVED_GAME_IMPORTS = {
    "alarms",
    "clock",
    "date_and_time",
    "interactions",
    "objects",
    "scheduling",
    "server",
    "services",
    "sims",
    "sims4",
}

FORBIDDEN_CALL_NAMES = {
    "__import__",
    "add_buff",
    "add_selectable_sim_info",
    "advance_current_time",
    "cancel",
    "compile",
    "destroy",
    "disable_autonomy",
    "enable_autonomy",
    "eval",
    "exec",
    "execute",
    "inject_safely_into",
    "pause_the_game",
    "push_super_affordance",
    "remove_buff",
    "remove_selectable_sim_info",
    "reset",
    "save_game_gen",
    "save_using",
    "set_active_sim",
    "set_clock_speed",
    "set_current_time",
    "system",
    "test_and_execute",
}

FORBIDDEN_IMPORT_ROOTS = {
    "http",
    "importlib",
    "s4cl",
    "shm",
    "socket",
    "ssl",
    "subprocess",
    "urllib",
}

# End of verification-only tables.
