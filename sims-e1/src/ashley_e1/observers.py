"""Read-only game observation surface for the E1 probe."""

import services  # PRIOR_ART|RUNTIME_UNVERIFIED: vanilla service getters.
import time

from objects import ALL_HIDDEN_REASONS  # PRIOR_ART|RUNTIME_UNVERIFIED: approved hidden-flag constant.

from . import schema
from . import snapshot


class SelectabilityReadFailure(RuntimeError):
    pass


class LabIdentityAmbiguous(RuntimeError):
    def __init__(self, eligible_count):
        super().__init__("LAB_IDENTITY_AMBIGUOUS:%s" % eligible_count)
        self.eligible_count = eligible_count


def select_lab_body(candidates, hidden_flags):
    eligible = []
    for si in candidates:
        if si is None:
            continue
        try:
            sim = si.get_sim_instance(allow_hidden_flags=hidden_flags)
        except Exception:
            continue
        if sim is None:
            continue
        try:
            selectable = si.is_selectable
        except Exception as error:
            raise SelectabilityReadFailure("SELECTABILITY_READ_FAILURE") from error
        if type(selectable) is not bool:
            raise SelectabilityReadFailure("SELECTABILITY_READ_FAILURE")
        if selectable is True:
            eligible.append((si, sim))
    if len(eligible) != 1:
        raise LabIdentityAmbiguous(len(eligible))
    return eligible[0]


def _monotonic_ns():
    return time.perf_counter_ns()


def _save_snapshot():
    persistence = services.get_persistence_service()
    guid = persistence.get_save_slot_proto_guid()
    buff = persistence.get_save_slot_proto_buff()
    raw_slot_id = None if buff is None else buff.slot_id
    return {"save_slot_guid": None if guid is None else str(guid),
            "slot_id": None if raw_slot_id is None else str(raw_slot_id)}


def _game_snapshot():
    time_service = services.time_service()
    sim_now = time_service.sim_now
    ticks = sim_now.absolute_ticks()
    clock = services.game_clock_service()
    speed = clock.clock_speed
    try:
        speed = speed.name
    except AttributeError:
        pass
    return {"ticks": int(ticks), "calendar": str(sim_now),
            "clock_speed": str(speed), "paused": speed == "PAUSED"}


def _describe_interaction(entry):
    row = snapshot.minimal_interaction(entry)
    try:
        row["affordance_id"] = str(entry.guid64)
    except Exception:
        pass
    try:
        row["affordance_text"] = str(entry.affordance)
    except Exception:
        pass
    try:
        row["target_id"] = str(entry.target.id)
    except Exception:
        pass
    try:
        row["source_raw"] = str(entry.context.source)
    except Exception:
        pass
    return row


def poll_once(telemetry_session_id, armed_name,
              hidden_flags=ALL_HIDDEN_REASONS):
    """Read one body and return a plain-data presence record."""
    candidates = services.sim_info_manager().get_all()
    sim_info, sim = select_lab_body(candidates, hidden_flags)
    raw_queued = sim.queue
    raw_running = sim.si_state
    capture_complete = raw_queued is not None and raw_running is not None
    queued = () if raw_queued is None else raw_queued
    running = () if raw_running is None else raw_running
    interactions, queue_truncated, running_truncated = snapshot.merge_interactions(
        queued, running, _describe_interaction
    )
    save = _save_snapshot()
    game = _game_snapshot()
    wall = int(time.time() * 1000)
    mono = _monotonic_ns()
    raw_sim_id = sim_info.id
    sim_id = None if raw_sim_id is None else str(raw_sim_id)
    body = {"sim_id": sim_id, "instantiated": True, "is_selectable": True,
            "is_selected": None, "posture": None}
    complete = snapshot.interactions_complete(
        queue_truncated, running_truncated, capture_complete)
    return schema.make_record(
        "presence_snapshot", telemetry_session_id=telemetry_session_id,
        wall_timestamp_ms=wall, monotonic_ns=mono,
        game=game, attestation=schema.attestation(armed_name, None, None,
                                                  save["save_slot_guid"], sim_id),
        save=save, body=body,
        interactions={"observed": interactions, "queue_truncated": queue_truncated,
                      "running_truncated": running_truncated,
                      "observation_complete": complete},
        observation_complete=complete,
    )
