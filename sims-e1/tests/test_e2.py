import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest

from test_binding import FakeWriter, load_probe

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SPEC = importlib.util.spec_from_file_location("e2_check_guards",
                                              os.path.join(ROOT, "tools", "check_guards.py"))
guards = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guards)

SOFA = "118245043789434044"
CHAIR = "118245043789434099"
PIE = "InteractionSource.PIE_MENU"
AUTO = "InteractionSource.AUTONOMY"
POSTURE = "InteractionSource.POSTURE_GRAPH"


def _load_pure():
    load_probe()
    from ashley_e1 import e2_admission, e2_lineage, e2_registry, schema, writer
    return e2_admission, e2_lineage, e2_registry, schema, writer


def _row(mono_s, entries=(), posture_name="stand", target=None, complete=True):
    return {"monotonic_ns": int(mono_s * 1e9), "observation_complete": complete,
            "interactions": {"observed": [dict(e) for e in entries]},
            "body": {"posture": {"posture_name": posture_name, "target_id": target}}}


def _entry(iid, source, membership="QUEUED", target=None, affordance_id=None):
    return {"interaction_id": iid, "source_raw": source, "membership": membership,
            "target_id": target, "affordance_id": affordance_id}


class LineageTests(unittest.TestCase):
    def setUp(self):
        _, self.lineage, _, _, _ = _load_pure()

    def save(self, slot, ticks, loaded_from, guid="g"):
        return {"record": "SAVE_OBSERVED", "guid": guid, "slot_id": slot,
                "ticks": ticks, "loaded_from_slot_id": loaded_from}

    def test_every_classification_row(self):
        L = self.lineage
        records = [self.save("2", 1000, "2")]
        self.assertEqual(L.classify(records, "g", "2", "s", 1000), L.CONTINUES_LAST_SAVE)
        self.assertEqual(L.classify(records, "g", "2", "s", 900), L.ROLLBACK)
        self.assertEqual(L.classify(records, "g", "2", "s", 1100), L.UNOBSERVED_SAVE)
        self.assertEqual(L.classify(records, "g", "9", "s", 1000), L.FOREIGN_OR_UNKNOWN)
        self.assertEqual(L.classify([], "g", "2", "s", 1000), L.FOREIGN_OR_UNKNOWN)
        self.assertEqual(L.classify(records, None, "2", "s", 1000), L.FOREIGN_OR_UNKNOWN)
        body = [{"record": "DESIGNATED_BODY", "guid": "g", "sim_id": "other"}]
        self.assertEqual(L.classify(records + body, "g", "2", "s", 1000), L.BODY_MISMATCH)

    def test_save_as_fork_then_saves_in_fork_continue(self):
        L = self.lineage
        records = [self.save("2", 1000, "2"), self.save("3", 1500, "2")]
        self.assertEqual(L.classify(records, "g", "3", "s", 1500), L.FORK)
        records.append(self.save("3", 2000, "3"))
        self.assertEqual(L.classify(records, "g", "3", "s", 2000), L.CONTINUES_LAST_SAVE)
        # origin slot keeps its own history
        self.assertEqual(L.classify(records, "g", "2", "s", 1000), L.CONTINUES_LAST_SAVE)

    def test_save_as_onto_existing_slot_is_lineage_transfer(self):
        L = self.lineage
        records = [self.save("2", 1000, "2"), self.save("3", 1500, "2"),
                   self.save("2", 1800, "3")]
        self.assertEqual(L.classify(records, "g", "2", "s", 1800), L.LINEAGE_TRANSFER)
        self.assertFalse(L.is_admissible(L.LINEAGE_TRANSFER))

    def test_epsilon_and_reclassification(self):
        L = self.lineage
        records = [self.save("2", 1000, "2")]
        self.assertEqual(L.classify(records, "g", "2", "s", 1003), L.UNOBSERVED_SAVE)
        self.assertEqual(L.classify(records, "g", "2", "s", 1003, epsilon=5),
                         L.CONTINUES_LAST_SAVE)
        self.assertEqual(L.reclassify_after_save(L.FOREIGN_OR_UNKNOWN), L.CONTINUES_LAST_SAVE)
        self.assertEqual(L.reclassify_after_save(L.BODY_MISMATCH), L.BODY_MISMATCH)


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.adm, self.lineage, _, _, _ = _load_pure()

    def view(self, **overrides):
        view = {"sampling": True, "lineage_class": self.lineage.CONTINUES_LAST_SAVE,
                "designated_sim_id": None, "sim_id": "s", "body_available": True,
                "guid": "g", "slot_id": "2", "paused": False, "posture_target_id": None,
                "entries": [_entry("1", POSTURE, "RUNNING"), _entry("2", AUTO)],
                "object": {"exists": True, "sit_offer_count": 1}}
        view.update(overrides)
        return view

    def check(self, view, obj=CHAIR, signatures=None, own=()):
        signatures = {CHAIR: "sit"} if signatures is None else signatures
        return self.adm.check(view, obj, frozenset((SOFA,)), signatures, set(own))

    def test_admissible_standing_body_with_posture_and_autonomy_idles(self):
        self.assertIsNone(self.check(self.view()))

    def test_each_rejection_code(self):
        A, L = self.adm, self.lineage
        cases = (
            (self.view(sampling=False), A.NOT_SAMPLING),
            (self.view(lineage_class=None), A.LINEAGE_PENDING),
            (self.view(lineage_class=L.BODY_MISMATCH), A.BODY_MISMATCH),
            (self.view(lineage_class=L.ROLLBACK), A.LINEAGE_NOT_ADMISSIBLE),
            (self.view(designated_sim_id="other"), A.BODY_MISMATCH),
            (self.view(body_available=False), A.BODY_UNAVAILABLE),
            (self.view(object={"exists": False, "sit_offer_count": 0}), A.NO_OBJECT),
            (self.view(object={"exists": True, "sit_offer_count": 0}), A.AFFORDANCE_NOT_OFFERED),
            (self.view(object={"exists": True, "sit_offer_count": 2}), A.AFFORDANCE_NOT_OFFERED),
            (self.view(posture_target_id=CHAIR), A.PRECONDITION_PRESENT),
            (self.view(entries=[_entry("9", PIE)]), A.BODY_BUSY),
            (self.view(entries=[_entry("9", "InteractionSource.SCRIPT_WITH_USER_INTENT")]), A.BODY_BUSY),
            (self.view(paused=True), A.CLOCK_PAUSED),
            (self.view(paused=None), A.CLOCK_PAUSED),
        )
        for view, code in cases:
            with self.subTest(code=code):
                self.assertEqual(self.check(view), code)
        self.assertEqual(self.check(self.view(), obj=SOFA), A.OBJECT_EXCLUDED)
        self.assertEqual(self.check(self.view(), signatures={}), A.SIGNATURE_UNKNOWN)
        self.assertEqual(self.check(self.view(entries=[_entry("7", AUTO)]), own=("7",)),
                         A.BODY_BUSY)

    def test_tokens_single_use_expiry_replay_and_stale(self):
        A = self.adm
        book = A.TokenBook(token_factory=iter(["%016x" % n for n in range(10)]).__next__)
        view = self.view()
        token, code = book.issue(CHAIR, view, 0.0)
        self.assertIsNone(code)
        bound, code = book.consume(token, 5.0)
        self.assertIsNotNone(bound)
        self.assertEqual(book.consume(token, 6.0), (None, A.REPLAY_REJECTED))
        self.assertEqual(book.consume("f" * 16, 6.0), (None, A.TOKEN_UNKNOWN))
        late, _ = book.issue(CHAIR, view, 10.0)
        self.assertEqual(book.consume(late, 41.0), (None, A.TOKEN_EXPIRED))
        swept, _ = book.issue(CHAIR, view, 50.0)
        book.issue(CHAIR, view, 100.0)  # expiry sweep happens on issue
        self.assertEqual(book.consume(swept, 101.0), (None, A.TOKEN_EXPIRED))
        self.assertEqual(book.consume(swept, 102.0), (None, A.REPLAY_REJECTED))
        sig = {CHAIR: "sit"}
        self.assertIsNone(A.admit(bound, view, CHAIR, frozenset(), sig, set()))
        moved = self.view(posture_target_id=CHAIR)
        self.assertEqual(A.admit(bound, moved, CHAIR, frozenset(), sig, set()), A.STALE_SNAPSHOT)
        busy = self.view(entries=[_entry("5", PIE)])
        self.assertEqual(A.admit(bound, busy, CHAIR, frozenset(), sig, set()), A.STALE_SNAPSHOT)
        other_slot = self.view(slot_id="3")
        self.assertEqual(A.admit(bound, other_slot, CHAIR, frozenset(), sig, set()),
                         A.STALE_SNAPSHOT)

    def test_token_capacity_is_bounded(self):
        A = self.adm
        book = A.TokenBook()
        for _ in range(A.MAX_OPEN_TOKENS):
            self.assertIsNotNone(book.issue(CHAIR, self.view(), 0.0)[0])
        self.assertEqual(book.issue(CHAIR, self.view(), 0.0), (None, A.TOO_MANY_TOKENS))


class RegistryTests(unittest.TestCase):
    def setUp(self):
        _, _, self.reg, _, _ = _load_pure()

    def experiment(self, signature="sit"):
        return self.reg.Experiment("e-1", "t" * 16, CHAIR, "s", "100", 0,
                                   signature, ["1", "2"])

    def test_success_ladder_passes_only_after_maintained(self):
        exp = self.experiment()
        ours_q = _entry("100", "InteractionSource.SCRIPT_WITH_USER_INTENT", "QUEUED", CHAIR)
        ours_r = dict(ours_q, membership="RUNNING")
        self.assertEqual(exp.observe(_row(1, [ours_q])), ["ENQUEUED"])
        self.assertEqual(exp.observe(_row(2, [ours_r], "sit", CHAIR)),
                         ["STARTED", "EFFECT_OBSERVED", "ATTRIBUTED"])
        exp.observe(_row(8, [ours_r], "sit", CHAIR))
        self.assertFalse(exp.claims["MAINTAINED_10S"])
        exp.observe(_row(12.5, [ours_r], "sit", CHAIR))
        self.assertTrue(exp.claims["MAINTAINED_10S"])
        self.assertFalse(exp.claims["FINISHED"])
        self.assertEqual(exp.close(), self.reg.PASS)

    def test_foreign_root_or_incomplete_row_blocks_attribution(self):
        ours = _entry("100", "InteractionSource.SCRIPT_WITH_USER_INTENT", "RUNNING", CHAIR)
        exp = self.experiment()
        exp.observe(_row(1, [ours, _entry("200", PIE)]))
        exp.observe(_row(2, [ours], "sit", CHAIR))
        self.assertTrue(exp.claims["EFFECT_OBSERVED"])
        self.assertFalse(exp.claims["ATTRIBUTED"])
        self.assertEqual(exp.foreign_roots, ["200"])
        self.assertEqual(exp.close(), self.reg.OUTCOME_UNKNOWN)
        exp = self.experiment()
        exp.observe(_row(1, [ours], complete=False))
        exp.observe(_row(2, [ours], "sit", CHAIR))
        self.assertFalse(exp.claims["ATTRIBUTED"])
        exp = self.experiment()
        exp.observe(_row(1, [ours, _entry("300", AUTO, target=CHAIR)]))
        self.assertEqual(exp.foreign_roots, ["300"])

    def test_known_baseline_and_autonomy_idles_are_not_foreign(self):
        ours = _entry("100", "InteractionSource.SCRIPT_WITH_USER_INTENT", "RUNNING", CHAIR)
        exp = self.experiment()
        exp.observe(_row(1, [ours, _entry("1", PIE), _entry("400", AUTO),
                             _entry("401", POSTURE, "RUNNING")], "sit", CHAIR))
        self.assertEqual(exp.foreign_roots, [])
        self.assertTrue(exp.claims["ATTRIBUTED"])

    def test_no_signature_means_no_effect_claim(self):
        ours = _entry("100", "X", "RUNNING", CHAIR)
        exp = self.experiment(signature=None)
        exp.observe(_row(2, [ours], "sit", CHAIR))
        self.assertTrue(exp.claims["STARTED"])
        self.assertFalse(exp.claims["EFFECT_OBSERVED"])

    def test_posture_break_resets_maintenance_and_window_closes(self):
        ours = _entry("100", "X", "RUNNING", CHAIR)
        exp = self.experiment()
        exp.observe(_row(2, [ours], "sit", CHAIR))
        exp.observe(_row(7, [ours], "stand", None))
        exp.observe(_row(13, [ours], "sit", CHAIR))
        self.assertFalse(exp.claims["MAINTAINED_10S"])
        exp.observe(_row(61, [], "sit", CHAIR))
        self.assertTrue(exp.closed)
        self.assertEqual(exp.verdict, self.reg.OUTCOME_UNKNOWN)

    def test_absence_never_sets_finished_only_callback_does(self):
        exp = self.experiment()
        exp.observe(_row(2, [_entry("100", "X", "RUNNING", CHAIR)]))
        exp.observe(_row(3, []))
        self.assertFalse(exp.claims["FINISHED"])
        exp.finish("FinishingType.NATURAL")
        self.assertTrue(exp.claims["FINISHED"])
        self.assertEqual(exp.finishing_type, "FinishingType.NATURAL")

    def test_signature_learned_only_from_owner_pie_sit(self):
        learner = self.reg.SignatureLearner()
        click = _entry("50", PIE, target=CHAIR, affordance_id="31564")
        self.assertIsNone(learner.observe(_row(1, [click]), set()))
        self.assertEqual(learner.observe(_row(3, [], "sitSingle", CHAIR), set()),
                         (CHAIR, "sitSingle"))
        other = self.reg.SignatureLearner()
        other.observe(_row(1, [click]), {"50"})
        self.assertIsNone(other.observe(_row(3, [], "sitSingle", CHAIR), set()))
        stale = self.reg.SignatureLearner()
        stale.observe(_row(1, [click]), set())
        self.assertIsNone(stale.observe(_row(40, [], "sitSingle", CHAIR), set()))


class _Posture:
    def __init__(self, name, target):
        self.name = name
        self.target = target


class _Obj:
    def __init__(self, object_id, offers=1):
        self.id = int(object_id)
        self._offers = offers

    def super_affordances(self, context=None):
        yield types.SimpleNamespace(guid64=999)
        for _ in range(self._offers):
            yield types.SimpleNamespace(guid64=31564)


class _Interaction:
    def __init__(self, iid):
        self.id = iid
        self.finishing_type = "FinishingType.NATURAL"
        self.callbacks = []

    def register_on_finishing_callback(self, callback):
        self.callbacks.append(callback)


class _EnqueueResult(tuple):
    def __new__(cls, ok, interaction):
        return tuple.__new__(cls, (ok, None if not ok else
                                   types.SimpleNamespace(interaction=interaction)))

    @property
    def execute_result(self):
        return self[1]

    def __bool__(self):
        return bool(self[0]) and self[1] is not None

    @property
    def interaction(self):
        return self[1].interaction  # raises when the test failed, like 1.128


class ControlFlowTests(unittest.TestCase):
    def setUp(self):
        self.package, self.probe, self.calls = load_probe()
        self.services = sys.modules["services"]
        self.objects = {CHAIR: _Obj(CHAIR), SOFA: _Obj(SOFA)}
        self.pushes = self.calls["pushes"]
        self.sim = types.SimpleNamespace(queue=[], si_state=[],
                                         posture=_Posture("stand", None))
        self.push_ok = True

        def push(affordance, target, context):
            self.pushes.append((affordance.guid64, target.id, context))
            return _EnqueueResult(self.push_ok, _Interaction(777))

        self.sim.push_super_affordance = push
        sim = self.sim

        class SimInfo:
            is_selectable = True
            id = 118245043779534861

            def get_sim_instance(self, allow_hidden_flags=None):
                return sim

        info = SimInfo()
        self.services.sim_info_manager = lambda: types.SimpleNamespace(get_all=lambda: [info])
        self.services.object_manager = lambda: types.SimpleNamespace(
            get=lambda oid: self.objects.get(str(oid)))
        persistence = self.services.get_persistence_service()
        persistence.get_save_slot_proto_guid = lambda: 2773024768
        self.saved_ticks = 1000
        persistence.get_save_slot_proto_buff = lambda: types.SimpleNamespace(
            slot_id=2, gameplay_data=types.SimpleNamespace(world_game_time=self.saved_ticks))
        self.services.get_persistence_service = lambda: persistence
        self.clock_speed = "NORMAL"
        clock = self.services.game_clock_service()
        type(clock).clock_speed = property(lambda _self: self.clock_speed)
        self.services.game_clock_service = lambda: clock
        self.ticks = 1000
        test = self

        class _Now:
            def absolute_ticks(self):
                return test.ticks

            def __str__(self):
                return "13:00 day:0"

        self.services.time_service = lambda: types.SimpleNamespace(sim_now=_Now())

        class LedgerWriter(FakeWriter):
            records = []

            def ledger_snapshot(inner):
                return "OK", tuple(LedgerWriter.records)

        self.LedgerWriter = LedgerWriter
        self.probe.TelemetryWriter = LedgerWriter

    def rows(self, kind=None):
        rows = self.LedgerWriter.instances[-1].rows if self.LedgerWriter.instances else []
        return [r for r in rows if kind is None or r["event_kind"] == kind]

    def e2(self, kind):
        return [r["e2"] for r in self.rows(kind)]

    def arm_start_poll(self, records=()):
        self.LedgerWriter.records = list(records)
        self.assertTrue(self.probe._cmd_arm("LAB_E1"))
        self.assertTrue(self.probe._cmd_start())
        self.tick()

    def tick(self):
        self.probe._poll_tick(self.calls["alarms"][-1][0])

    def learn_signature(self):
        click = types.SimpleNamespace(id=50, guid64=31564, affordance="sit",
                                      target=types.SimpleNamespace(id=int(CHAIR)),
                                      context=types.SimpleNamespace(source=PIE))
        self.sim.queue = [click]
        self.tick()
        self.sim.queue = []
        self.sim.posture = _Posture("sitSingle", types.SimpleNamespace(id=int(CHAIR)))
        self.tick()
        self.sim.posture = _Posture("stand", None)
        self.tick()

    def test_arm_subscribes_disarm_unsubscribes_and_releases_pause(self):
        self.arm_start_poll()
        self.assertEqual(len(self.calls["save_callbacks"]), 1)
        self.assertFalse(self.probe._dispatch_e2_pause("x", _session_id=1))
        self.assertTrue(self.probe._dispatch_e2_pause(_session_id=1))
        self.assertFalse(self.probe._dispatch_e2_pause(_session_id=1))
        self.assertTrue(self.probe._cmd_stop())
        self.assertEqual([c[0] for c in self.calls["speed"]], ["push", "remove"])
        self.assertTrue(self.probe._cmd_disarm())
        self.assertEqual(self.calls["save_callbacks"], [])
        phases = [p["phase"] for p in self.e2("speed_event")]
        # the arity-violating dispatch is rejected by the adapter with no event
        self.assertEqual(phases, ["REQUEST_PUSHED", "REJECT", "RELEASED_ON_DISARM"])

    def test_pause_requires_sampling_and_release_requires_request(self):
        self.assertTrue(self.probe._cmd_arm("LAB_E1"))
        self.assertFalse(self.probe._dispatch_e2_pause(_session_id=1))
        self.assertTrue(self.probe._cmd_start())
        self.assertFalse(self.probe._dispatch_e2_release(_session_id=1))
        self.assertTrue(self.probe._dispatch_e2_pause(_session_id=1))
        self.assertTrue(self.probe._dispatch_e2_release(_session_id=1))
        self.assertEqual(self.calls["speed"][0][1:], ("request", "PAUSED", "GAMEPLAY",
                                                      "ashley_e2_pause"))
        self.assertEqual(self.calls["speed"][1][2:], ("GAMEPLAY", "ashley_e2_release"))

    def test_first_poll_classifies_lineage_and_unknown_blocks_prepare(self):
        self.arm_start_poll()
        lineage = self.e2("lineage_event")
        self.assertEqual([l["record"] for l in lineage], ["LOAD_OBSERVED", "CLASSIFIED"])
        self.assertEqual(lineage[1]["lineage_class"], "FOREIGN_OR_UNKNOWN")
        self.assertEqual(lineage[0]["ticks"], 1000)

    def test_classification_uses_saved_proto_ticks_not_live_clock(self):
        self.ticks = 99999  # Owner armed long after load; live clock moved on
        self.arm_start_poll(self.continuing())
        lineage = self.e2("lineage_event")
        self.assertEqual((lineage[1]["lineage_class"], lineage[1]["ticks"]),
                         ("CONTINUES_LAST_SAVE", 1000))
        self.saved_ticks = 900
        self.probe._cmd_disarm()
        self.LedgerWriter.instances[-1].finish()
        self.arm_start_poll(self.continuing())
        self.assertEqual(self.e2("lineage_event")[1]["lineage_class"], "ROLLBACK")
        self.assertFalse(self.probe._dispatch_e2_prepare(CHAIR, _session_id=1))
        self.assertEqual(self.e2("experiment_event")[-1]["code"], "LINEAGE_NOT_ADMISSIBLE")

    def test_armed_owner_save_bootstraps_lineage_and_records_save(self):
        self.arm_start_poll()
        self.ticks = 1500
        self.saved_ticks = 1500  # the save wrote current ticks into the proto
        self.calls["save_callbacks"][0]()
        lineage = self.e2("lineage_event")
        save = [l for l in lineage if l["record"] == "SAVE_OBSERVED"][0]
        self.assertEqual((save["guid"], save["slot_id"], save["ticks"],
                          save["loaded_from_slot_id"]), ("2773024768", "2", 1500, "2"))
        self.assertEqual(lineage[-1]["lineage_class"], "CONTINUES_LAST_SAVE")

    def test_save_callback_is_inert_when_unarmed(self):
        self.arm_start_poll()
        callback = self.calls["save_callbacks"][0]
        self.assertTrue(self.probe._cmd_disarm())
        before = len(self.rows())
        callback()
        self.assertEqual(len(self.rows()), before)

    def continuing(self):
        return [{"record": "SAVE_OBSERVED", "guid": "2773024768", "slot_id": "2",
                 "ticks": 1000, "loaded_from_slot_id": "2"}]

    def test_full_experiment_prepare_sit_push_and_verdict(self):
        self.arm_start_poll(self.continuing())
        self.assertFalse(self.probe._dispatch_e2_prepare(CHAIR, _session_id=1))
        self.assertEqual(self.e2("experiment_event")[-1]["code"], "SIGNATURE_UNKNOWN")
        self.learn_signature()
        learned = [e for e in self.e2("experiment_event") if e["phase"] == "SIGNATURE_LEARNED"]
        self.assertEqual((learned[0]["object_id"], learned[0]["detail"]), (CHAIR, "sitSingle"))
        self.assertTrue(self.probe._dispatch_e2_prepare(CHAIR, _session_id=1))
        ok = self.e2("experiment_event")[-1]
        self.assertEqual(ok["phase"], "PREPARE_OK")
        designated = [l for l in self.e2("lineage_event") if l["record"] == "DESIGNATED_BODY"]
        self.assertEqual(designated[0]["sim_id"], "118245043779534861")
        self.assertFalse(self.probe._dispatch_e2_sit(ok["token"].upper(), _session_id=1))
        self.assertTrue(self.probe._dispatch_e2_sit(ok["token"], _session_id=1))
        self.assertEqual(len(self.pushes), 1)
        guid64, target, context = self.pushes[0]
        self.assertEqual((guid64, target), (31564, int(CHAIR)))
        pushed = self.e2("experiment_event")[-1]
        self.assertEqual((pushed["phase"], pushed["interaction_id"]), ("PUSHED", "777"))
        self.assertFalse(self.probe._dispatch_e2_sit(ok["token"], _session_id=1))
        self.assertEqual(self.e2("experiment_event")[-1]["code"], "REPLAY_REJECTED")
        ours = types.SimpleNamespace(id=777, guid64=31564, affordance="sit",
                                     target=types.SimpleNamespace(id=int(CHAIR)),
                                     context=types.SimpleNamespace(
                                         source="InteractionSource.SCRIPT_WITH_USER_INTENT"))
        self.sim.si_state = [ours]
        self.sim.posture = _Posture("sitSingle", types.SimpleNamespace(id=int(CHAIR)))
        self.tick()
        claims = [e["code"] for e in self.e2("experiment_event") if e["phase"] == "CLAIM"]
        self.assertEqual(claims, ["ENQUEUED", "STARTED", "EFFECT_OBSERVED", "ATTRIBUTED"])
        self.assertTrue(self.probe._cmd_stop())
        verdict = self.e2("experiment_event")[-1]
        self.assertEqual((verdict["phase"], verdict["code"]), ("VERDICT", "OUTCOME_UNKNOWN"))
        for row in self.rows():
            self.package.schema.validate_record(row)

    def test_push_failure_never_touches_interaction_and_opens_no_experiment(self):
        self.arm_start_poll(self.continuing())
        self.learn_signature()
        self.probe._dispatch_e2_prepare(CHAIR, _session_id=1)
        token = self.e2("experiment_event")[-1]["token"]
        self.push_ok = False
        self.assertFalse(self.probe._dispatch_e2_sit(token, _session_id=1))
        self.assertEqual(self.e2("experiment_event")[-1]["phase"], "PUSH_FAILED")
        self.assertEqual(self.probe._E2.experiments, {})

    def test_negative_controls_wrong_targets_and_arguments(self):
        self.arm_start_poll(self.continuing())
        self.learn_signature()
        self.assertFalse(self.probe._dispatch_e2_prepare("123", _session_id=1))
        self.assertEqual(self.e2("experiment_event")[-1]["code"], "NO_OBJECT")
        self.assertFalse(self.probe._dispatch_e2_prepare(SOFA, _session_id=1))
        self.assertEqual(self.e2("experiment_event")[-1]["code"], "OBJECT_EXCLUDED")
        self.objects["55"] = _Obj("55", offers=0)
        self.assertFalse(self.probe._dispatch_e2_prepare("55", _session_id=1))
        self.assertEqual(self.e2("experiment_event")[-1]["code"], "AFFORDANCE_NOT_OFFERED")
        before = len(self.rows())
        for bad in (("abc",), ("1", "2"), ()):
            self.assertFalse(self.probe._dispatch_e2_prepare(*bad, _session_id=1))
        self.assertFalse(self.probe._dispatch_e2_sit("zzzz", _session_id=1))
        self.assertEqual(len(self.rows()), before)
        self.assertEqual(self.pushes, [])

    def test_stale_snapshot_when_owner_moves_body_between_prepare_and_sit(self):
        self.arm_start_poll(self.continuing())
        self.learn_signature()
        self.probe._dispatch_e2_prepare(CHAIR, _session_id=1)
        token = self.e2("experiment_event")[-1]["token"]
        self.sim.posture = _Posture("sitSingle", types.SimpleNamespace(id=int(CHAIR)))
        self.assertFalse(self.probe._dispatch_e2_sit(token, _session_id=1))
        self.assertEqual(self.e2("experiment_event")[-1]["code"], "STALE_SNAPSHOT")
        self.assertEqual(self.pushes, [])

    def test_finishing_callback_sets_finished_with_game_value(self):
        self.arm_start_poll(self.continuing())
        self.learn_signature()
        self.probe._dispatch_e2_prepare(CHAIR, _session_id=1)
        token = self.e2("experiment_event")[-1]["token"]
        interactions = []
        original = self.sim.push_super_affordance

        def capture(affordance, target, context):
            result = original(affordance, target, context)
            interactions.append(result.execute_result.interaction)
            return result

        self.sim.push_super_affordance = capture
        self.assertTrue(self.probe._dispatch_e2_sit(token, _session_id=1))
        interaction = interactions[0]
        self.assertEqual(len(interaction.callbacks), 1)
        interaction.callbacks[0](interaction)
        event = self.e2("experiment_event")[-1]
        self.assertEqual((event["phase"], event["finishing_type"]),
                         ("FINISHED_CALLBACK", "FinishingType.NATURAL"))
        self.assertTrue(event["claims"]["FINISHED"])


class WriterLedgerTests(unittest.TestCase):
    def setUp(self):
        _, _, _, self.schema, self.writer = _load_pure()

    def lineage_row(self, record="SAVE_OBSERVED"):
        payload = dict((k, None) for k in self.schema.E2_PAYLOAD_KEYS["lineage_event"])
        payload.update({"record": record, "guid": "g", "slot_id": "2", "sim_id": "s",
                        "ticks": 10, "loaded_from_slot_id": "2", "session_uuid": "u"})
        return self.schema.make_record("lineage_event", telemetry_session_id="u",
                                       wall_timestamp_ms=5, monotonic_ns=6, e2=payload)

    def test_ledger_loads_appends_and_survives_restart(self):
        with tempfile.TemporaryDirectory() as temp:
            sink = self.writer.TelemetryWriter(temp, "u", "2.0.0", "1.128.90.1030")
            self.assertTrue(sink.try_put(self.lineage_row()))
            self.assertTrue(sink.try_put(self.lineage_row("CLASSIFIED")))
            sink.signal_close("DISARM_CLEAN")
            self.assertTrue(sink.wait_idle(5.0))
            state, records = sink.ledger_snapshot()
            self.assertEqual(state, "OK")
            self.assertEqual([r["record"] for r in records], ["SAVE_OBSERVED"])
            again = self.writer.TelemetryWriter(temp, "v", "2.0.0", "1.128.90.1030")
            again.signal_close("ARMED_NEVER_STARTED")
            self.assertTrue(again.wait_idle(5.0))
            state, records = again.ledger_snapshot()
            self.assertEqual((state, records[0]["ticks"], records[0]["session_id"]),
                             ("OK", 10, "u"))

    def test_corrupt_or_oversized_ledger_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            path = os.path.join(temp, self.writer.LEDGER_FILENAME)
            with open(path, "wb") as handle:
                handle.write(b"{not json\n")
            sink = self.writer.TelemetryWriter(temp, "u", "2.0.0", "1.128.90.1030")
            sink.signal_close("ARMED_NEVER_STARTED")
            self.assertTrue(sink.wait_idle(5.0))
            self.assertEqual(sink.ledger_snapshot()[0], "UNREADABLE")
            with open(path, "wb") as handle:
                handle.write(b"x" * (self.writer.MAX_LEDGER_BYTES + 1))
            sink = self.writer.TelemetryWriter(temp, "v", "2.0.0", "1.128.90.1030")
            sink.signal_close("ARMED_NEVER_STARTED")
            self.assertTrue(sink.wait_idle(5.0))
            self.assertEqual(sink.ledger_snapshot()[0], "TOO_LARGE")


class SchemaV2Tests(unittest.TestCase):
    def setUp(self):
        _, _, _, self.schema, _ = _load_pure()

    def test_e2_payloads_validate_and_are_closed(self):
        S = self.schema
        payload = dict((k, None) for k in S.E2_PAYLOAD_KEYS["experiment_event"])
        payload.update({"phase": "CLAIM", "code": "ENQUEUED",
                        "claims": dict((k, False) for k in S.CLAIM_KEYS)})
        row = S.make_record("experiment_event", telemetry_session_id="u", e2=payload)
        S.validate_record(row)
        for broken in (dict(payload, extra=1), dict(payload, phase="WHATEVER"),
                       dict(payload, claims={"ENQUEUED": True})):
            with self.subTest(broken=broken):
                with self.assertRaises(S.SchemaError):
                    S.validate_record(S.make_record("experiment_event",
                                                    telemetry_session_id="u", e2=broken))
        with self.assertRaises(S.SchemaError):
            S.validate_record(S.make_record("guard_exhausted", telemetry_session_id="u",
                                            reason="X", e2=payload))

    def test_posture_and_interaction_id_fields(self):
        S = self.schema
        body = {"sim_id": "1", "instantiated": True, "is_selectable": True,
                "is_selected": None,
                "posture": {"posture_name": "sitSingle", "target_id": CHAIR}}
        entry = {"entry_key": "0x1", "interaction_id": "777", "affordance_id": "31564",
                 "affordance_text": "x", "target_id": CHAIR, "source_raw": PIE,
                 "source_norm": "UNKNOWN", "source_confidence": "UNKNOWN",
                 "present": True, "membership": "RUNNING"}
        row = S.make_record("presence_snapshot", telemetry_session_id="u",
                            observation_complete=True, body=body,
                            interactions={"observed": [entry], "queue_truncated": False,
                                          "running_truncated": False,
                                          "observation_complete": True})
        S.validate_record(row)
        with self.assertRaises(S.SchemaError):
            bad = dict(body, posture={"posture_name": "x"})
            S.validate_record(S.make_record("presence_snapshot", telemetry_session_id="u",
                                            observation_complete=True, body=bad))


class E2GuardTests(unittest.TestCase):
    def test_actuator_calls_only_in_actuator(self):
        for call in ("sim.push_super_affordance(a, b, c)", "clock.push_speed(1)",
                     "clock.remove_request(r)", "i.register_on_finishing_callback(f)",
                     "p.add_manual_save_complete_callback(f)"):
            with self.subTest(call=call):
                self.assertTrue(guards.scan_text(call, "probe.py"))
                self.assertTrue(guards.scan_text(call, "e2_control.py"))
                self.assertEqual(guards.scan_text(call, "e2_actuator.py"), [])
        for call in ("aop.test_and_execute(c)", "sim.reset()", "clock.set_clock_speed(0)"):
            self.assertTrue(guards.scan_text(call, "e2_actuator.py"))

    def test_pure_modules_reject_game_imports(self):
        for name in ("e2_admission.py", "e2_lineage.py", "e2_registry.py"):
            self.assertTrue(guards.scan_text("import services", name))


if __name__ == "__main__":
    unittest.main()
