import io
import json
import unittest
from contextlib import redirect_stdout

from cosy_cli import CosyClient, Game, semantic_story_events


class SemanticStoryReceiptTests(unittest.TestCase):
    def test_cli_prints_one_authored_receipt_and_keeps_raw_events_inspectable(self) -> None:
        text = (
            "Kit Featherstep rekindles the dark Mothwood beacon. "
            "The beacon burns again and makes the Mothwood road trustworthy after dusk. "
            "Progress: 6/6. The road remembers Kit Featherstep's work. "
            "Kit Featherstep earns 2 Orbs. "
            "Next: carry the relit road's news back to Mara Wick."
        )
        raw_events = [
            {
                "seq": 11,
                "type": "job.contribution.resolved",
                "actor_name": "Kit Featherstep",
                "location_id": 804,
            },
            {
                "seq": 12,
                "type": "clock.updated",
                "actor_name": "Kit Featherstep",
                "clock_label": "Rekindle the Beacon",
                "clock_filled": 6,
                "clock_segments": 6,
            },
            {
                "seq": 13,
                "type": "tag.cleared",
                "actor_name": "Kit Featherstep",
                "tag_label": "spent preparation",
            },
        ]
        receipt = {
            "seq": 14,
            "type": "story.receipt",
            "actor_name": "Kit Featherstep",
            "content": json.dumps(
                {
                    "schema_version": 1,
                    "narration_key": "lantern-keeper.work",
                    "text": text,
                    "event_seqs": [11, 12, 13],
                    "next_response": "carry the relit road's news back to Mara Wick.",
                }
            ),
        }
        events = [*raw_events, receipt]

        self.assertEqual(semantic_story_events(events), [receipt])
        self.assertEqual(events[:3], raw_events)

        game = Game(CosyClient("http://127.0.0.1:3102"), 42, "session")
        output = io.StringIO()
        with redirect_stdout(output):
            game.print_events(events)
        rendered = output.getvalue()
        self.assertEqual(rendered, f"[14] ✦ {text}\n")
        for malformed in (
            "grew from what happened",
            "became frontier travel",
            "became spent preparation",
            "The Road Goes Fully Dark draws closer",
            "shook off spent preparation",
        ):
            self.assertNotIn(malformed, rendered)

    def test_cli_projects_promoted_question_and_exact_two_suggestion_rationales(self) -> None:
        question = {
            "promoted": True,
            "presentation_state": "active",
            "question": "Can travelers find Rowan Vale and rekindle the Mothwood beacon?",
            "situation": "One more road lamp goes out. The dark now reaches the next bend.",
            "filled": 2,
            "segments": 6,
            "danger_filled": 1,
            "danger_segments": 6,
            "outcome": "The beacon burns again and makes the Mothwood road trustworthy after dusk.",
            "danger_situation": "One more road lamp goes out. The dark now reaches the next bend.",
            "danger_consequence": "The dark road becomes a lantern for borrowed shadows.",
            "suggested_actions": [
                {
                    "label": "Prepare",
                    "target_label": "the dark Mothwood beacon",
                    "source": "From Rekindle the beacon",
                    "likely_effect": "makes the next try count; current progress is 2/6 and danger is 1/6",
                    "risk": None,
                },
                {
                    "label": "Rest",
                    "target_label": "Wayside Lantern Inn",
                    "source": "From Wayside Lantern Inn",
                    "likely_effect": "The Road Goes Fully Dark advances from 1/6 to 2/6",
                    "risk": "trouble may draw nearer while you rest",
                },
            ],
        }
        game = Game(CosyClient("http://127.0.0.1:3102"), 42, "session")
        output = io.StringIO()
        with redirect_stdout(output):
            game.print_shared_question([question])
        rendered = output.getvalue()
        self.assertIn("Progress: 2/6. Danger: 1/6.", rendered)
        self.assertIn("Suggestion 1 of 2: Prepare.", rendered)
        self.assertIn("Target: the dark Mothwood beacon.", rendered)
        self.assertIn("Source: From Rekindle the beacon.", rendered)
        self.assertIn("Suggestion 2 of 2: Rest.", rendered)
        self.assertIn("The Road Goes Fully Dark advances from 1/6 to 2/6", rendered)
        self.assertNotIn("Suggestion 3", rendered)
        self.assertNotRegex(rendered, r"action \d+ of \d+")

    def test_cli_keeps_forming_relationship_and_dialogue_failure_explicit(self) -> None:
        game = Game(CosyClient("http://127.0.0.1:3102"), 42, "session")
        forming = game.format_event(
            {
                "seq": 21,
                "type": "bond.created",
                "actor_name": "Kit Featherstep",
                "target_actor_name": "Mara Wick",
                "content": "bond:42:8301:1:forming:advancement",
            }
        )
        beat = game.format_event(
            {
                "seq": 22,
                "type": "relationship.beat",
                "content": "Mara places Rowan's empty key hook on the bar.",
            }
        )
        unavailable = game.format_event(
            {
                "seq": 23,
                "type": "dialogue.unavailable",
                "target_actor_name": "Mara Wick",
            }
        )
        self.assertIn("forming Bond with Mara Wick", forming)
        self.assertNotIn("friend", forming.lower())
        self.assertIn("empty key hook", beat)
        self.assertIn("Dialogue unavailable with Mara Wick", unavailable)
        self.assertIn("no substitute speech", unavailable)


if __name__ == "__main__":
    unittest.main()
