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


if __name__ == "__main__":
    unittest.main()
