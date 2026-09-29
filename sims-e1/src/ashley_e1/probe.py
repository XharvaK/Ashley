"""Owner-command state machine and one real-time alarm callback."""

try:
    import alarms  # PRIOR_ART|RUNTIME_UNVERIFIED: vanilla real-time alarm API.
except ImportError:
    alarms = None
try:
    import clock  # PRIOR_ART|RUNTIME_UNVERIFIED: vanilla real-time interval API.
except ImportError:
    clock = None
try:
    import date_and_time  # PRIOR_ART|RUNTIME_UNVERIFIED: vanilla TimeSpan API.
except ImportError:
    date_and_time = None
try:
    import interactions.context as _interaction_context_module  # PRIOR_ART|RUNTIME_UNVERIFIED: read surface.
except ImportError:
    _interaction_context_module = None
try:
    import server.clientmanager as _clientmanager_module  # PRIOR_ART|RUNTIME_UNVERIFIED: client manager surface.
except ImportError:
    _clientmanager_module = None
try:
    import services as _services_module  # PRIOR_ART|RUNTIME_UNVERIFIED: vanilla service getters.
except ImportError:
    _services_module = None
try:
    from sims.sim import Sim as _Sim  # PRIOR_ART|RUNTIME_UNVERIFIED: approved Sim surface.
except ImportError:
    _Sim = None
try:
    from sims.sim_info import SimInfo as _SimInfo  # PRIOR_ART|RUNTIME_UNVERIFIED: approved SimInfo surface.
except ImportError:
    _SimInfo = None
try:
    import sims4.commands as _commands_module  # PRIOR_ART|RUNTIME_UNVERIFIED: vanilla command surface.
except ImportError:
    _commands_module = None
import time
import uuid

try:
    from sims4.commands import (CommandType, CommandRestrictionFlags,
                                register)  # PRIOR_ART|RUNTIME_UNVERIFIED: vanilla command surface.
except ImportError:
    CommandType = None
    CommandRestrictionFlags = None
    register = None

from . import e2_control
from . import observers
from . import schema
from .writer import TelemetryWriter, bootstrap_from_module_path, derive_telemetry_root


E1_PROBE_VERSION = schema.PROBE_VERSION
SIMS_BUILD = schema.SIMS_BUILD
try:
    TimeSpan = date_and_time.TimeSpan
except AttributeError:
    TimeSpan = None
try:
    interval_in_real_seconds = clock.interval_in_real_seconds
except AttributeError:
    interval_in_real_seconds = None
try:
    _alarms_add_alarm_real_time = alarms.add_alarm_real_time
except AttributeError:
    _alarms_add_alarm_real_time = None
try:
    _alarms_cancel_alarm = alarms.cancel_alarm
except AttributeError:
    _alarms_cancel_alarm = None
try:
    _services_sim_info_manager = _services_module.sim_info_manager
except AttributeError:
    _services_sim_info_manager = None
try:
    _services_client_manager = _services_module.client_manager
except AttributeError:
    _services_client_manager = None
try:
    _interaction_context_type = _interaction_context_module.InteractionContext
except AttributeError:
    _interaction_context_type = None
try:
    _commands_output = _commands_module.output
except AttributeError:
    _commands_output = None

_INITIALIZED = False


class _ProbeAlarmOwner:
    pass


_PROBE_ALARM_OWNER = _ProbeAlarmOwner()
_STATE = "UNARMED"
_ARMED_NAME = None
_ARMED_SNAPSHOT = None
_TELEMETRY_SESSION_ID = None
_ALARM_HANDLE = None
_WRITER = None
_WRITER_IDLE = True
_SESSION_OPENED = False
_POLL_BUSY = False
_TELEMETRY_ROOT = None
_MISUSE_COUNT = 0
_LAST_CAPTURE_COUNTERS = None
_COUNTERS = {"dropped_queue": 0, "dropped_overrun": 0,
             "dropped_serialize": 0, "redundant_starts": 0}

def _output(text, connection):
    if _commands_output is None:
        return
    try:
        _commands_output(text, connection)
    except Exception:
        pass


_E2 = e2_control.E2Control(
    emit=lambda row: _emit(row),
    get_state=lambda: _STATE,
    get_session_id=lambda: _TELEMETRY_SESSION_ID,
    get_armed_snapshot=lambda: _ARMED_SNAPSHOT,
    get_writer=lambda: _WRITER,
    output=_output,
)

_ARM_NATIVE_TO_CANONICAL = {
    "lab_e1": "LAB_E1",
    "lab_e1_fork": "LAB_E1_FORK",
}


def _dispatch_arm(*args, _session_id=0, **kwargs):
    if len(args) != 1 or kwargs:
        return False
    native_name = args[0]
    if type(native_name) is not str:
        return False
    canonical_name = _ARM_NATIVE_TO_CANONICAL.get(native_name)
    if canonical_name is None:
        return False
    return _cmd_arm(canonical_name, _connection=_session_id)


def _dispatch_disarm(*args, _session_id=0, **kwargs):
    if args or kwargs:
        return False
    return _cmd_disarm(_connection=_session_id)


def _dispatch_start(*args, _session_id=0, **kwargs):
    if args or kwargs:
        return False
    return _cmd_start(_connection=_session_id)


def _dispatch_stop(*args, _session_id=0, **kwargs):
    if args or kwargs:
        _emit_stop_failure("STOP_DISPATCH_INVALID_SHAPE")
        return False
    return _cmd_stop(_connection=_session_id)


def _dispatch_e2_prepare(*args, _session_id=0, **kwargs):
    if len(args) != 1 or kwargs or type(args[0]) is not str:
        return False
    object_id = args[0]
    if not object_id.isdigit() or len(object_id) > 20:
        return False
    return _E2.cmd_prepare(object_id, _session_id)


def _dispatch_e2_sit(*args, _session_id=0, **kwargs):
    if len(args) != 1 or kwargs or type(args[0]) is not str:
        return False
    token = args[0]
    if len(token) != 16 or any(ch not in "0123456789abcdef" for ch in token):
        return False
    return _E2.cmd_sit(token, _session_id)


def _dispatch_e2_pause(*args, _session_id=0, **kwargs):
    if args or kwargs:
        return False
    return _E2.cmd_pause(_session_id)


def _dispatch_e2_release(*args, _session_id=0, **kwargs):
    if args or kwargs:
        return False
    return _E2.cmd_release(_session_id)


def _register_commands():
    if register is None or CommandType is None or CommandRestrictionFlags is None:
        return False
    register('ashley_e1.arm', CommandRestrictionFlags.UNRESTRICTED,
             _dispatch_arm, 'Arm the Ashley E1 probe in LAB_E1 or LAB_E1_FORK.',
             'ashley_e1.arm LAB_E1 | ashley_e1.arm LAB_E1_FORK', CommandType.Live)
    register('ashley_e1.disarm', CommandRestrictionFlags.UNRESTRICTED,
             _dispatch_disarm, 'Disarm the Ashley E1 probe and close the session.',
             'ashley_e1.disarm', CommandType.Live)
    register('ashley_e1.start', CommandRestrictionFlags.UNRESTRICTED,
             _dispatch_start, 'Start Ashley E1 1 Hz sampling.',
             'ashley_e1.start', CommandType.Live)
    register('ashley_e1.stop', CommandRestrictionFlags.UNRESTRICTED,
             _dispatch_stop, 'Stop Ashley E1 sampling (remains armed).',
             'ashley_e1.stop', CommandType.Live)
    register('ashley_e2.prepare', CommandRestrictionFlags.UNRESTRICTED,
             _dispatch_e2_prepare, 'Prepare one E2 sit experiment on an object id.',
             'ashley_e2.prepare <object_id>', CommandType.Live)
    register('ashley_e2.sit', CommandRestrictionFlags.UNRESTRICTED,
             _dispatch_e2_sit, 'Admit and push one prepared E2 sit experiment.',
             'ashley_e2.sit <token>', CommandType.Live)
    register('ashley_e2.pause', CommandRestrictionFlags.UNRESTRICTED,
             _dispatch_e2_pause, 'Push the E2 probe pause request.',
             'ashley_e2.pause', CommandType.Live)
    register('ashley_e2.release', CommandRestrictionFlags.UNRESTRICTED,
             _dispatch_e2_release, 'Remove the E2 probe pause request.',
             'ashley_e2.release', CommandType.Live)
    return True


def _required_import_summary():
    return {
        "alarms": alarms is not None,
        "alarms.add_alarm_real_time": callable(_alarms_add_alarm_real_time),
        "alarms.cancel_alarm": callable(_alarms_cancel_alarm),
        "clock": clock is not None,
        "clock.interval_in_real_seconds": callable(interval_in_real_seconds),
        "date_and_time": date_and_time is not None,
        "date_and_time.TimeSpan": callable(TimeSpan),
        "services": _services_module is not None,
        "services.sim_info_manager": callable(_services_sim_info_manager),
        "services.client_manager": callable(_services_client_manager),
        "server.clientmanager": _clientmanager_module is not None,
        "sims.sim.Sim": _Sim is not None,
        "sims.sim_info.SimInfo": _SimInfo is not None,
        "interactions.context": _interaction_context_module is not None,
        "interactions.context.InteractionContext": _interaction_context_type is not None,
        "sims4.commands": _commands_module is not None,
        "sims4.commands.CommandType": CommandType is not None,
        "sims4.commands.CommandRestrictionFlags": CommandRestrictionFlags is not None,
        "sims4.commands.register": callable(register),
        "sims4.commands.output": callable(_commands_output),
        "e2.actuator": e2_control.e2_actuator is not None,
    }


def initialize_probe():
    global _INITIALIZED, _TELEMETRY_ROOT
    if _INITIALIZED:
        return
    _STATE_RESET()
    command_registration_result = _register_commands()
    if not command_registration_result:
        return
    _INITIALIZED = True
    _TELEMETRY_ROOT = derive_telemetry_root(__file__)
    if _TELEMETRY_ROOT is not None:
        bootstrap_from_module_path(
            __file__, E1_PROBE_VERSION, SIMS_BUILD,
            required_imports=_required_import_summary(),
        )


def _STATE_RESET():
    global _STATE, _ARMED_NAME, _ARMED_SNAPSHOT, _TELEMETRY_SESSION_ID
    global _ALARM_HANDLE, _WRITER, _WRITER_IDLE, _SESSION_OPENED, _POLL_BUSY
    global _MISUSE_COUNT, _LAST_CAPTURE_COUNTERS
    _STATE = "UNARMED"
    _ARMED_NAME = None
    _ARMED_SNAPSHOT = None
    _TELEMETRY_SESSION_ID = None
    _ALARM_HANDLE = None
    _WRITER = None
    _WRITER_IDLE = True
    _SESSION_OPENED = False
    _POLL_BUSY = False
    _MISUSE_COUNT = 0
    _LAST_CAPTURE_COUNTERS = None
    _COUNTERS["dropped_queue"] = 0
    _COUNTERS["dropped_overrun"] = 0
    _COUNTERS["dropped_serialize"] = 0
    _COUNTERS["redundant_starts"] = 0


def get_status():
    writer_state = "OK"
    rotation_index = 0
    if _WRITER is not None:
        try:
            writer_state = _WRITER.state
            rotation_index = _WRITER.rotation_index
        except AttributeError:
            pass
    return {
        "state": _STATE,
        "armed_name": _ARMED_NAME,
        "armed_snapshot": _ARMED_SNAPSHOT,
        "telemetry_session_id": _TELEMETRY_SESSION_ID,
        "alarm_handle": _ALARM_HANDLE,
        "writer_idle": _WRITER_IDLE,
        "counters": dict(_COUNTERS),
        "misuse_count": _MISUSE_COUNT,
        "writer": {"state": writer_state, "rotation_index": rotation_index},
    }


def _writer_became_idle():
    global _WRITER_IDLE
    _WRITER_IDLE = True


def _set_writer_sampling(active):
    if _WRITER is not None:
        try:
            _WRITER.set_sampling(active)
        except AttributeError:
            pass


def _emit_stop_failure(reason):
    if _WRITER is None or _STATE == "UNARMED":
        return False
    try:
        return _emit(schema.make_record(
            "guard_exhausted",
            telemetry_session_id=_TELEMETRY_SESSION_ID,
            wall_timestamp_ms=int(time.time() * 1000),
            monotonic_ns=time.perf_counter_ns(),
            reason=reason,
        ))
    except Exception:
        return False


def _cmd_arm(arm_name: str, _connection=None) -> bool:
    global _STATE, _ARMED_NAME, _ARMED_SNAPSHOT, _TELEMETRY_SESSION_ID
    global _WRITER, _WRITER_IDLE, _SESSION_OPENED, _MISUSE_COUNT
    global _LAST_CAPTURE_COUNTERS
    if arm_name not in ("LAB_E1", "LAB_E1_FORK"):
        _MISUSE_COUNT += 1
        return False
    if _STATE != "UNARMED" or not _WRITER_IDLE:
        return False
    if _TELEMETRY_ROOT is None:
        return False
    _TELEMETRY_SESSION_ID = str(uuid.uuid4())
    _ARMED_NAME = arm_name
    _ARMED_SNAPSHOT = None
    _SESSION_OPENED = False
    _LAST_CAPTURE_COUNTERS = None
    for key in _COUNTERS:
        _COUNTERS[key] = 0
    try:
        _WRITER = TelemetryWriter(_TELEMETRY_ROOT, _TELEMETRY_SESSION_ID,
                                  E1_PROBE_VERSION, SIMS_BUILD,
                                  on_idle=_writer_became_idle)
    except (OSError, IOError, ValueError):
        _WRITER = None
        _ARMED_NAME = None
        _TELEMETRY_SESSION_ID = None
        return False
    _WRITER_IDLE = False
    _STATE = "ARMED"
    _E2.on_arm()
    return True


def _cmd_start(_connection=None) -> bool:
    global _STATE, _ALARM_HANDLE
    if _STATE == "SAMPLING":
        _COUNTERS["redundant_starts"] += 1
        if _WRITER is not None:
            try:
                _WRITER.counters["redundant_starts"] = _COUNTERS["redundant_starts"]
            except AttributeError:
                pass
        return True
    if _STATE != "ARMED":
        return False
    try:
        _ALARM_HANDLE = alarms.add_alarm_real_time(owner=_PROBE_ALARM_OWNER,
            time_span=interval_in_real_seconds(1), callback=_poll_tick,
            repeating=True, use_sleep_time=False, cross_zone=False)
    except Exception:
        _ALARM_HANDLE = None
        return False
    _STATE = "SAMPLING"
    _set_writer_sampling(True)
    return True


def _cmd_stop(_connection=None) -> bool:
    global _STATE, _ALARM_HANDLE
    if _STATE == "UNARMED":
        return False
    if _STATE == "SAMPLING":
        if _ALARM_HANDLE is not None:
            try:
                alarms.cancel_alarm(_ALARM_HANDLE)
            except Exception as error:
                _emit_stop_failure("STOP_CANCEL_FAILURE:%s" %
                                   type(error).__name__)
                return False
        _ALARM_HANDLE = None
        _STATE = "ARMED"
        _set_writer_sampling(False)
        _E2.on_stop("STOP")
    return True


def _cmd_disarm(_connection=None) -> bool:
    global _STATE, _ARMED_NAME, _ARMED_SNAPSHOT, _SESSION_OPENED, _WRITER_IDLE
    if _STATE == "UNARMED":
        return True
    if not _cmd_stop():
        return False
    _set_writer_sampling(False)
    _E2.on_disarm()
    close_reason = "DISARM_CLEAN" if _SESSION_OPENED else "ARMED_NEVER_STARTED"
    if _WRITER is not None:
        _WRITER.signal_close(close_reason)
        try:
            _WRITER_IDLE = _WRITER.is_idle
        except AttributeError:
            _WRITER_IDLE = False
    _STATE = "UNARMED"
    _ARMED_NAME = None
    _ARMED_SNAPSHOT = None
    _SESSION_OPENED = False
    return True


def _emit(row):
    if _WRITER is None:
        return False
    for key, value in _COUNTERS.items():
        try:
            if value > _WRITER.counters.get(key, 0):
                _WRITER.counters[key] = value
        except AttributeError:
            break
    accepted = _WRITER.try_put(row)
    if not accepted:
        try:
            writer_counters = _WRITER.counters
        except AttributeError:
            writer_counters = {}
        accounted = False
        for key in ("dropped_queue", "dropped_serialize"):
            if writer_counters.get(key, 0) > _COUNTERS.get(key, 0):
                _COUNTERS[key] = writer_counters[key]
                accounted = True
        if not accounted:
            _COUNTERS["dropped_queue"] += 1
    return accepted


def _session_open_from(row):
    global _ARMED_SNAPSHOT
    save = row.get("save", {})
    body = row.get("body", {})
    snapshot_guid = save.get("save_slot_guid")
    snapshot_slot = save.get("slot_id")
    snapshot_sim = body.get("sim_id")
    _ARMED_SNAPSHOT = {"guid": snapshot_guid, "slot_id": snapshot_slot,
                       "sim_id": snapshot_sim,
                       "wall_ms": row["wall_timestamp_ms"],
                       "monotonic_ns": row["monotonic_ns"]}
    return schema.make_record(
        "session_open", telemetry_session_id=_TELEMETRY_SESSION_ID,
        wall_timestamp_ms=row["wall_timestamp_ms"], monotonic_ns=row["monotonic_ns"],
        attestation=schema.attestation(_ARMED_NAME, None, snapshot_guid,
                                       snapshot_slot, snapshot_sim),
        save=save, zone=row.get("zone", {}), body=body,
    )


def _poll_tick(alarm_handle=None):
    global _POLL_BUSY
    if _STATE != "SAMPLING":
        return
    if alarm_handle is not None and alarm_handle is not _ALARM_HANDLE:
        _cmd_stop()
        return
    if _POLL_BUSY:
        _COUNTERS["dropped_overrun"] += 1
        if _WRITER is not None:
            try:
                _WRITER.note_drop("SAMPLER_OVERRUN")
            except AttributeError:
                pass
        return
    _POLL_BUSY = True
    try:
        _poll_tick_body()
    finally:
        _POLL_BUSY = False


def _poll_tick_body():
    global _SESSION_OPENED, _LAST_CAPTURE_COUNTERS
    try:
        row = observers.poll_once(_TELEMETRY_SESSION_ID, _ARMED_NAME)
    except observers.SelectabilityReadFailure:
        _emit(schema.make_record("guard_exhausted", telemetry_session_id=_TELEMETRY_SESSION_ID,
                                 wall_timestamp_ms=int(time.time() * 1000),
                                 monotonic_ns=time.perf_counter_ns(),
                                 reason="SELECTABILITY_READ_FAILURE"))
        _cmd_stop()
        return
    except observers.LabIdentityAmbiguous as error:
        _emit(schema.make_record("guard_exhausted", telemetry_session_id=_TELEMETRY_SESSION_ID,
                                 wall_timestamp_ms=int(time.time() * 1000),
                                 monotonic_ns=time.perf_counter_ns(),
                                 reason="LAB_IDENTITY_AMBIGUOUS:%s" % error.eligible_count))
        _cmd_stop()
        return
    except Exception as error:
        reason = "OBSERVATION_FAILURE:%s" % type(error).__name__
        _emit(schema.make_record("guard_exhausted",
                                 telemetry_session_id=_TELEMETRY_SESSION_ID,
                                 wall_timestamp_ms=int(time.time() * 1000),
                                 monotonic_ns=time.perf_counter_ns(), reason=reason))
        _cmd_stop()
        return
    current = dict(_COUNTERS)
    writer_state = "OK"
    if _WRITER is not None:
        try:
            writer_state = _WRITER.state
        except AttributeError:
            writer_state = "OK"
        try:
            writer_counters = _WRITER.counters
        except AttributeError:
            writer_counters = {}
        for key in ("dropped_queue", "dropped_overrun", "dropped_serialize"):
            if writer_counters.get(key, 0) > current.get(key, 0):
                current[key] = writer_counters[key]
    capture_loss = (_LAST_CAPTURE_COUNTERS is not None and any(
        current.get(key, 0) > _LAST_CAPTURE_COUNTERS.get(key, 0)
        for key in ("dropped_queue", "dropped_overrun", "dropped_serialize")))
    if writer_state != "OK":
        capture_loss = True
    _LAST_CAPTURE_COUNTERS = current
    if capture_loss:
        row = dict(row)
        interactions = dict(row.get("interactions", {}))
        interactions["observation_complete"] = False
        row["interactions"] = interactions
        row["observation_complete"] = False
    if not _SESSION_OPENED:
        save = row.get("save", {})
        body = row.get("body", {})
        if (save.get("save_slot_guid") is None or
                save.get("slot_id") is None or
                body.get("sim_id") is None):
            _emit(schema.make_record(
                "guard_exhausted",
                telemetry_session_id=_TELEMETRY_SESSION_ID,
                wall_timestamp_ms=int(time.time() * 1000),
                monotonic_ns=time.perf_counter_ns(),
                reason="OBSERVATION_FAILURE:SESSION_OPEN_IDENTITY_INCOMPLETE",
            ))
            _cmd_stop()
            return
        if not _emit(_session_open_from(row)):
            _cmd_stop()
            return
        _SESSION_OPENED = True
    row = dict(row)
    row["attestation"] = schema.attestation(
        _ARMED_NAME, None, _ARMED_SNAPSHOT["guid"], _ARMED_SNAPSHOT["slot_id"],
        _ARMED_SNAPSHOT["sim_id"])
    if not _emit(row):
        _cmd_stop()
        return
    try:
        _E2.on_poll_row(row)
    except Exception as error:
        _emit(schema.make_record(
            "guard_exhausted", telemetry_session_id=_TELEMETRY_SESSION_ID,
            wall_timestamp_ms=int(time.time() * 1000),
            monotonic_ns=time.perf_counter_ns(),
            reason="E2_POLL_FAILURE:%s" % type(error).__name__))
