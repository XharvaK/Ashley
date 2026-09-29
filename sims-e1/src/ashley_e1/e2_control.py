"""E2 session control: commands, lineage, experiments, pause (plan E2 §6–§8).

Game thread only. All world actions go through e2_actuator; all reads through
observers/e2_actuator read helpers; all file I/O through the writer queue.
The host supplies emit/state callables so this module never imports probe.
"""

import time

from . import e2_admission
from . import e2_lineage
from . import e2_registry
from . import schema
from . import snapshot

try:
    from . import e2_actuator  # TARGET_BYTECODE 1.128 bindings; RUNTIME first-load gate.
except ImportError:
    e2_actuator = None
try:
    from . import observers
except ImportError:
    observers = None
try:
    import services  # PRIOR_ART|TARGET_BYTECODE: sim_info_manager read surface.
except ImportError:
    services = None

# E1 LAB sofa (target of the E1 Owner-sit witness): never an E2 experiment target.
EXCLUDED_OBJECT_IDS = frozenset(("118245043789434044",))


def _now():
    return time.perf_counter()


class E2Control:
    def __init__(self, emit, get_state, get_session_id, get_armed_snapshot,
                 get_writer, output):
        self._emit_row = emit
        self._state = get_state
        self._session_id = get_session_id
        self._armed_snapshot = get_armed_snapshot
        self._writer = get_writer
        self._output = output
        self._reset_state()

    # ------------------------------------------------------------------ state
    def _reset_state(self):
        self.tokens = e2_admission.TokenBook()
        self.learner = e2_registry.SignatureLearner()
        self.experiments = {}
        self.open_ids = set()
        self.lineage_class = None
        self.load_ticks = None
        self.live_slot = None
        self.designated_sim_id = None
        self.save_subscribed = False
        self.pause_request = None
        self.experiment_counter = 0

    def available(self):
        return (e2_actuator is not None and observers is not None and
                services is not None)

    # --------------------------------------------------------------- emitting
    def _event(self, kind, payload):
        keys = schema.E2_PAYLOAD_KEYS[kind]
        body = dict((key, None) for key in keys)
        body.update(payload)
        try:
            row = schema.make_record(
                kind, telemetry_session_id=self._session_id(),
                wall_timestamp_ms=int(time.time() * 1000),
                monotonic_ns=time.perf_counter_ns(), e2=body)
        except schema.SchemaError:
            return False
        return self._emit_row(row)

    def _experiment_event(self, phase, **payload):
        payload["phase"] = phase
        return self._event("experiment_event", payload)

    def _speed_event(self, phase, code=None, detail=None):
        return self._event("speed_event", {"phase": phase, "code": code, "detail": detail})

    def _lineage_event(self, record, **payload):
        payload["record"] = record
        payload["session_uuid"] = self._session_id()
        return self._event("lineage_event", payload)

    def _say(self, connection, text):
        try:
            self._output(text, connection)
        except Exception:
            pass

    # ------------------------------------------------------------- lifecycle
    def on_arm(self):
        self._reset_state()
        if not self.available():
            return
        try:
            e2_actuator.subscribe_saves(self.on_manual_save)
            self.save_subscribed = True
        except Exception:
            self.save_subscribed = False

    def on_stop(self, reason):
        """Called after a successful STOP (and by DISARM). Fail-safe cleanup."""
        self._release_pause(reason)
        for experiment in list(self.experiments.values()):
            if not experiment.closed:
                self._close_experiment(experiment)
        self.tokens.clear()

    def on_disarm(self):
        self.on_stop("DISARM")
        if self.save_subscribed and e2_actuator is not None:
            try:
                e2_actuator.unsubscribe_saves(self.on_manual_save)
            except Exception:
                pass
        self.save_subscribed = False

    # --------------------------------------------------------------- lineage
    def on_poll_row(self, row):
        """Feed every emitted presence row (game thread, after emit)."""
        if self.lineage_class is None:
            self._try_classify(row)
        learned = self.learner.observe(row, self.open_ids)
        if learned is not None:
            self._experiment_event("SIGNATURE_LEARNED", object_id=learned[0],
                                   detail=learned[1][:schema.MAX_DETAIL_LENGTH])
        for experiment in list(self.experiments.values()):
            if experiment.closed:
                continue
            for claim in experiment.observe(row):
                self._experiment_event("CLAIM", experiment_id=experiment.experiment_id,
                                       object_id=experiment.object_id,
                                       interaction_id=experiment.interaction_id,
                                       code=claim, claims=dict(experiment.claims))
            if experiment.closed:
                self._emit_verdict(experiment)

    def _try_classify(self, row):
        writer = self._writer()
        if writer is None:
            return
        try:
            state, records = writer.ledger_snapshot()
        except AttributeError:
            return
        if state == "PENDING":
            return
        save = row.get("save") or {}
        body = row.get("body") or {}
        try:
            ticks = observers._saved_world_ticks()
        except Exception:
            ticks = None
        guid, slot, sim_id = save.get("save_slot_guid"), save.get("slot_id"), body.get("sim_id")
        if state != "OK":
            lineage_class = e2_lineage.FOREIGN_OR_UNKNOWN
        else:
            lineage_class = e2_lineage.classify(records, guid, slot, sim_id, ticks)
            designated = e2_lineage.designated_body(records, guid)
            self.designated_sim_id = None if designated is None else designated.get("sim_id")
        self.lineage_class = lineage_class
        self.load_ticks = ticks
        self.live_slot = slot
        self._lineage_event("LOAD_OBSERVED", guid=guid, slot_id=slot, sim_id=sim_id, ticks=ticks)
        self._lineage_event("CLASSIFIED", guid=guid, slot_id=slot, sim_id=sim_id, ticks=ticks,
                            lineage_class=lineage_class)

    def on_manual_save(self, *args, **kwargs):
        """Persistence-service callback (no arguments on 1.128). Armed only."""
        if self._state() not in ("ARMED", "SAMPLING") or observers is None:
            return
        try:
            save = observers._save_snapshot()
            saved_ticks = observers._saved_world_ticks()
        except Exception as error:
            self._lineage_event("SAVE_OBSERVED", lineage_class="READ_FAILURE:%s" %
                                type(error).__name__)
            return
        snap = self._armed_snapshot() or {}
        self._lineage_event("SAVE_OBSERVED", guid=save.get("save_slot_guid"),
                            slot_id=save.get("slot_id"), sim_id=snap.get("sim_id"),
                            ticks=saved_ticks, loaded_from_slot_id=self.live_slot)
        self.live_slot = save.get("slot_id")
        if self.lineage_class is not None:
            self.lineage_class = e2_lineage.reclassify_after_save(self.lineage_class)
            self._lineage_event("CLASSIFIED", guid=save.get("save_slot_guid"),
                                slot_id=save.get("slot_id"), sim_id=snap.get("sim_id"),
                                ticks=saved_ticks, lineage_class=self.lineage_class)

    # ------------------------------------------------------------- admission
    def _view(self, object_id):
        """Fresh plain-data admission view (game-thread reads only)."""
        view = {"sampling": self._state() == "SAMPLING",
                "lineage_class": self.lineage_class,
                "designated_sim_id": self.designated_sim_id}
        sim_info, sim = observers.select_lab_body(
            services.sim_info_manager().get_all(), observers.ALL_HIDDEN_REASONS)
        save = observers._save_snapshot()
        game = observers._game_snapshot()
        queued = () if sim.queue is None else sim.queue
        running = () if sim.si_state is None else sim.si_state
        entries, _, _ = snapshot.merge_interactions(
            queued, running, observers._describe_interaction)
        posture = observers._posture_snapshot(sim) or {}
        obj = e2_actuator.find_object(object_id)
        offers = []
        context = e2_actuator.build_context(sim)
        if obj is not None:
            offers = e2_actuator.sit_offers(obj, context)
        view.update({
            "guid": save.get("save_slot_guid"), "slot_id": save.get("slot_id"),
            "sim_id": None if sim_info.id is None else str(sim_info.id),
            "body_available": sim is not None, "ticks": game.get("ticks"),
            "paused": game.get("paused"), "posture_target_id": posture.get("target_id"),
            "entries": entries,
            "object": {"exists": obj is not None, "sit_offer_count": len(offers)},
        })
        return view, sim, obj, offers, context

    def cmd_prepare(self, object_id, connection):
        if not self.available():
            self._say(connection, "E2_UNAVAILABLE")
            return False
        try:
            view, _, _, _, _ = self._view(object_id)
            code = e2_admission.check(view, object_id, EXCLUDED_OBJECT_IDS,
                                      self.learner.signatures, self.open_ids)
            if code is not None:
                self._experiment_event("PREPARE_REJECT", object_id=object_id, code=code)
                self._say(connection, "PREPARE_REJECT %s" % code)
                return False
            token, code = self.tokens.issue(object_id, view, _now())
            if token is None:
                self._experiment_event("PREPARE_REJECT", object_id=object_id, code=code)
                self._say(connection, "PREPARE_REJECT %s" % code)
                return False
            if self.designated_sim_id is None:
                self.designated_sim_id = view["sim_id"]
                self._lineage_event("DESIGNATED_BODY", guid=view["guid"], slot_id=view["slot_id"],
                                    sim_id=view["sim_id"], ticks=view["ticks"],
                                    lineage_class=self.lineage_class)
            self._experiment_event("PREPARE_OK", object_id=object_id, token=token)
            self._say(connection, "PREPARE_OK token %s (30 s)" % token)
            return True
        except Exception as error:
            code = "E2_EXCEPTION:%s" % type(error).__name__
            self._experiment_event("PREPARE_REJECT", object_id=object_id, code=code[:64])
            self._say(connection, "PREPARE_REJECT %s" % code)
            return False

    def cmd_sit(self, token, connection):
        if not self.available():
            self._say(connection, "E2_UNAVAILABLE")
            return False
        try:
            bound, code = self.tokens.consume(token, _now())
            if bound is None:
                self._experiment_event("ADMIT_REJECT", token=token, code=code)
                self._say(connection, "ADMIT_REJECT %s" % code)
                return False
            object_id = bound["object_id"]
            view, sim, obj, offers, context = self._view(object_id)
            code = e2_admission.admit(bound, view, object_id, EXCLUDED_OBJECT_IDS,
                                      self.learner.signatures, self.open_ids)
            if code is not None:
                self._experiment_event("ADMIT_REJECT", token=token, object_id=object_id, code=code)
                self._say(connection, "ADMIT_REJECT %s" % code)
                return False
            self.experiment_counter += 1
            experiment_id = "%s-%d" % (self._session_id()[:8], self.experiment_counter)
            pushed_ns = time.perf_counter_ns()
            interaction, detail = e2_actuator.push_sit(sim, obj, offers[0], context)
            if interaction is None:
                self._experiment_event("PUSH_FAILED", experiment_id=experiment_id,
                                       token=token, object_id=object_id,
                                       detail=(detail or "")[:schema.MAX_DETAIL_LENGTH])
                self._say(connection, "PUSH_FAILED")
                return False
            interaction_id = str(interaction.id)
            experiment = e2_registry.Experiment(
                experiment_id, token, object_id, view["sim_id"], interaction_id, pushed_ns,
                self.learner.signatures.get(object_id),
                [entry.get("interaction_id") for entry in view["entries"]])
            self.experiments[experiment_id] = experiment
            self.open_ids.add(interaction_id)

            def _finished(finished_interaction, _experiment=experiment):
                try:
                    finishing = str(finished_interaction.finishing_type)
                except Exception:
                    finishing = "UNREADABLE"
                _experiment.finish(finishing[:schema.MAX_DISPLAY_TEXT_LENGTH])
                self._experiment_event("FINISHED_CALLBACK",
                                       experiment_id=_experiment.experiment_id,
                                       interaction_id=_experiment.interaction_id,
                                       finishing_type=_experiment.finishing_type,
                                       claims=dict(_experiment.claims))

            try:
                e2_actuator.watch_finish(interaction, _finished)
            except Exception:
                pass
            self._experiment_event("PUSHED", experiment_id=experiment_id, token=token,
                                   object_id=object_id, interaction_id=interaction_id,
                                   claims=dict(experiment.claims))
            self._say(connection, "PUSHED %s interaction %s" % (experiment_id, interaction_id))
            return True
        except Exception as error:
            code = "E2_EXCEPTION:%s" % type(error).__name__
            self._experiment_event("ADMIT_REJECT", token=token, code=code[:64])
            self._say(connection, "ADMIT_REJECT %s" % code)
            return False

    def _close_experiment(self, experiment):
        experiment.close()
        self._emit_verdict(experiment)

    def _emit_verdict(self, experiment):
        self.open_ids.discard(experiment.interaction_id)
        detail = "foreign_roots=%d incomplete_rows=%d" % (
            len(experiment.foreign_roots), experiment.incomplete_rows)
        self._experiment_event("VERDICT", experiment_id=experiment.experiment_id,
                               object_id=experiment.object_id,
                               interaction_id=experiment.interaction_id,
                               code=experiment.verdict, claims=dict(experiment.claims),
                               finishing_type=experiment.finishing_type, detail=detail)

    # ----------------------------------------------------------------- speed
    def cmd_pause(self, connection):
        if not self.available():
            self._say(connection, "E2_UNAVAILABLE")
            return False
        if self._state() != "SAMPLING":
            self._speed_event("REJECT", code="NOT_SAMPLING")
            self._say(connection, "PAUSE_REJECT NOT_SAMPLING")
            return False
        if self.pause_request is not None:
            self._speed_event("REJECT", code="ALREADY_REQUESTED")
            self._say(connection, "PAUSE_REJECT ALREADY_REQUESTED")
            return False
        try:
            self.pause_request = e2_actuator.push_pause()
        except Exception as error:
            self.pause_request = None
            self._speed_event("REJECT", code="E2_EXCEPTION:%s" % type(error).__name__)
            self._say(connection, "PAUSE_REJECT EXCEPTION")
            return False
        self._speed_event("REQUEST_PUSHED")
        self._say(connection, "PAUSE_REQUESTED")
        return True

    def cmd_release(self, connection):
        if self.pause_request is None:
            self._speed_event("REJECT", code="NO_REQUEST")
            self._say(connection, "RELEASE_REJECT NO_REQUEST")
            return False
        if not self._remove_request():
            self._speed_event("RELEASE_FAILED", code="REMOVE_FAILED")
            self._say(connection, "RELEASE_FAILED")
            return False
        self._speed_event("REQUEST_REMOVED")
        self._say(connection, "RELEASED")
        return True

    def _remove_request(self):
        try:
            e2_actuator.remove_pause(self.pause_request)
        except Exception:
            return False
        self.pause_request = None
        return True

    def _release_pause(self, reason):
        if self.pause_request is None:
            return
        if self._remove_request():
            self._speed_event("RELEASED_ON_DISARM", detail=reason)
        else:
            self._speed_event("RELEASE_FAILED", code="REMOVE_FAILED", detail=reason)
