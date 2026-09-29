import json
import os
import sys
import types
import unittest


SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
if SRC not in sys.path:
    sys.path.insert(0, SRC)
if "ashley_e1" not in sys.modules:
    package = types.ModuleType("ashley_e1")
    package.__path__ = [os.path.join(SRC, "ashley_e1")]
    sys.modules["ashley_e1"] = package

from ashley_e1 import writer


class SequenceTests(unittest.TestCase):
    def test_contiguous_written_order(self):
        rows = [json.dumps({"written_sequence": value}) for value in (0, 1, 2)]
        result = writer.validate_jsonl_lines(rows)
        self.assertTrue(result["valid"])
        self.assertFalse(result["truncated_tail"])

    def test_planted_gap_fails(self):
        rows = [json.dumps({"written_sequence": value}) for value in (0, 2)]
        result = writer.validate_jsonl_lines(rows)
        self.assertFalse(result["valid"])
        self.assertIn("sequence", result["reason"])

    def test_only_one_trailing_partial_line_is_tolerated(self):
        rows = [json.dumps({"written_sequence": 0}), '{"written_sequence":']
        result = writer.validate_jsonl_lines(rows)
        self.assertTrue(result["valid"])
        self.assertTrue(result["truncated_tail"])
        two_bad = writer.validate_jsonl_lines(["{", "{"])
        self.assertFalse(two_bad["valid"])


if __name__ == "__main__":
    unittest.main()
