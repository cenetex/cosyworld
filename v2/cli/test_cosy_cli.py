import io
import json
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from cosy_cli import ButtonGame, ClientError, CosyClient, Game, offer_intent_id, semantic_story_events


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

    def test_cli_act_lists_and_runs_only_the_dealt_offer(self) -> None:
        game = Game(CosyClient("http://127.0.0.1:3102"), 42, "session")
        state = {
            "action_hand": {
                "generation": 7,
                "entries": [{
                    "slot": "story",
                    "offer_id": "srd5.2.1:9:move:move Rain-Soft Garden",
                    "think": {"available": False},
                }],
            },
            "action_offers": [
                {
                    "offer_id": "srd5.2.1:9:move:move Rain-Soft Garden",
                    "kind": "move",
                    "label": "Travel",
                    "command": "move Rain-Soft Garden",
                    "target": {"kind": "location", "label": "Rain-Soft Garden"},
                }
            ],
            "primary_action": {"options": [{"kind": "attack", "label": "Attack"}]},
        }
        game.state = lambda: state  # type: ignore[method-assign]
        payloads: list[tuple[str, dict[str, object]]] = []
        game.client.post = lambda path, payload: (  # type: ignore[method-assign]
            payloads.append((path, payload)) or {"ok": True, "events": []}
        )

        with patch("builtins.input", return_value="1"):
            game.act()

        self.assertEqual(payloads[0][0], "/commands")
        self.assertNotIn("command", payloads[0][1])
        self.assertEqual(payloads[0][1]["offer_id"], "srd5.2.1:9:move:move Rain-Soft Garden")
        intent_id = payloads[0][1]["envelope"]["intent_id"]
        self.assertRegex(intent_id, r"^[A-Za-z0-9_.:-]{1,160}$")
        self.assertEqual(intent_id, "cli:offer:42:sha256:d1e85f339fde5350fc8f7ac33abece4b815bd00eb5340eaebc57c36bbe2b0c96")
        output = io.StringIO()
        with redirect_stdout(output):
            game.print_action_hand(state["action_hand"], state["action_offers"])
        self.assertIn("Travel — Rain-Soft Garden", output.getvalue())
        self.assertNotIn("Attack", output.getvalue())

    def test_cli_think_hashes_a_spaced_card_certificate(self) -> None:
        game = Game(CosyClient("http://127.0.0.1:3102"), 42, "session")
        game.state = lambda: {  # type: ignore[method-assign]
            "action_hand": {"entries": [{
                "slot": "story",
                "offer_id": "move-garden",
                "think": {"available": True, "offer_id": "think:42:9:story:7:Moonlit Garden"},
            }]}
        }
        payloads: list[dict[str, object]] = []
        game.client.post = lambda _path, payload: payloads.append(payload) or {"ok": True, "events": []}  # type: ignore[method-assign]

        game.pass_hand()

        intent_id = payloads[0]["envelope"]["intent_id"]
        self.assertRegex(intent_id, r"^[A-Za-z0-9_.:-]{1,160}$")
        self.assertEqual(intent_id, offer_intent_id(42, "think:42:9:story:7:Moonlit Garden"))

    def test_cli_think_retries_the_same_pending_certificate_after_transport_failure(self) -> None:
        game = Game(CosyClient("http://127.0.0.1:3102"), 42, "session")
        first_state = {
            "action_hand": {"entries": [{
                "slot": "story",
                "offer_id": "first",
                "think": {"available": True, "offer_id": "think:42:1:story:0:first"},
            }]},
            "world_seq": 10,
        }
        changed_state = {
            "action_hand": {"entries": [{
                "slot": "story",
                "offer_id": "next",
                "think": {"available": True, "offer_id": "think:42:2:story:1:next"},
            }]},
            "world_seq": 11,
        }
        state_calls = 0

        def state() -> dict[str, object]:
            nonlocal state_calls
            state_calls += 1
            return first_state if state_calls == 1 else changed_state

        game.state = state  # type: ignore[method-assign]
        payloads: list[dict[str, object]] = []

        def post(_path: str, payload: dict[str, object]) -> dict[str, object]:
            payloads.append(payload)
            if len(payloads) == 1:
                raise ClientError("transport interrupted")
            return {"ok": True, "events": []}

        game.client.post = post  # type: ignore[method-assign]

        with self.assertRaisesRegex(ClientError, "transport interrupted"):
            game.pass_hand()
        game.pass_hand()

        self.assertEqual(payloads[0], payloads[1])
        self.assertEqual(payloads[1]["offer_id"], "think:42:1:story:0:first")
        self.assertEqual(
            payloads[1]["envelope"]["intent_id"],
            offer_intent_id(42, "think:42:1:story:0:first"),
        )

    def test_cli_act_refuses_retired_draw_alias(self) -> None:
        game = Game(CosyClient("http://127.0.0.1:3102"), 42, "session")
        game.state = lambda: {"action_offers": [], "action_hand": {"entries": []}}  # type: ignore[method-assign]
        with patch("builtins.input", return_value="draw"):
            with self.assertRaisesRegex(ValueError, "numbered Story Hand card"):
                game.act()

    def test_cli_empty_hand_does_not_render_a_leading_separator(self) -> None:
        game = Game(CosyClient("http://127.0.0.1:3102"), 42, "session")
        output = io.StringIO()
        with redirect_stdout(output):
            game.print_action_hand(
                {"entries": []},
                [],
            )

        self.assertEqual(output.getvalue(), "")


class ExactOfferSelectionTests(unittest.TestCase):
    def test_cli_selects_the_exact_gift_trade_use_and_project_offer(self) -> None:
        game = Game(CosyClient("http://127.0.0.1:3102"), 42, "session")
        state = {
            "action_hand": {"entries": []},
            "action_offers": [
                {"offer_id": "gift-a", "id": "give_item:100:7", "kind": "give_item", "target": {"kind": "actor", "id": 7}},
                {"offer_id": "gift-b", "id": "give_item:101:8", "kind": "give_item", "target": {"kind": "actor", "id": 8}},
                {"offer_id": "trade-a", "id": "trade_item:100:7:900", "kind": "trade_item", "target": {"kind": "item", "id": 900}},
                {"offer_id": "trade-b", "id": "trade_item:101:8:901", "kind": "trade_item", "target": {"kind": "item", "id": 901}},
                {"offer_id": "use-a", "id": "use_item:100", "kind": "use_item", "provider": {"id": "item:100"}},
                {"offer_id": "use-b", "id": "use_item:101", "kind": "use_item", "provider": {"id": "item:101"}},
                {"offer_id": "work-a", "id": "work:a", "kind": "work", "project": {"id": "job-a", "strategy_id": "steady"}},
                {"offer_id": "work-b", "id": "work:b", "kind": "work", "project": {"id": "job-b", "strategy_id": "bold"}},
            ]
        }
        game.state = lambda: state  # type: ignore[method-assign]

        state["action_hand"] = {"entries": [{"offer_id": "gift-b"}]}
        self.assertEqual(
            game.current_offer("/actions/give-item", {"item_id": 101, "target_actor_id": 8}),
            state["action_offers"][1],
        )
        state["action_hand"] = {"entries": [{"offer_id": "trade-b"}]}
        self.assertEqual(
            game.current_offer("/actions/trade-item", {"item_id": 101, "target_actor_id": 8, "target_item_id": 901}),
            state["action_offers"][3],
        )
        state["action_hand"] = {"entries": [{"offer_id": "use-b"}]}
        self.assertEqual(
            game.current_offer("/actions/use-item", {"item_id": 101}),
            state["action_offers"][5],
        )
        state["action_hand"] = {"entries": [{"offer_id": "work-b"}]}
        self.assertEqual(
            game.current_offer("/actions/contribute", {"job_id": "job-b", "strategy_id": "bold"}),
            state["action_offers"][7],
        )
        state["action_hand"] = {"entries": [{"offer_id": "gift-b"}]}
        self.assertIsNone(game.current_offer("/actions/give-item", {"item_id": 100, "target_actor_id": 8}))

    def test_button_game_exposes_each_exact_dealt_use_card(self) -> None:
        game = ButtonGame(CosyClient("http://127.0.0.1:3102"), 42, "session")
        state = {
            "world_seq": 18,
            "actors": [
                {
                    "id": 42,
                    "name": "Moss Stitch",
                    "hp": 1,
                    "canonical_ref": "actor://cosyworld/42",
                }
            ],
            "action_hand": {"entries": [{"offer_id": "use-a"}, {"offer_id": "use-b"}]},
            "action_offers": [
                {
                    "offer_id": "use-a",
                    "kind": "use_item",
                    "label": "Use Amber Charm",
                    "command": "use Amber Charm",
                    "target": {"kind": "item", "label": "Amber Charm"},
                },
                {
                    "offer_id": "use-b",
                    "kind": "use_item",
                    "label": "Use Blue Charm",
                    "command": "use Blue Charm",
                    "target": {"kind": "item", "label": "Blue Charm"},
                },
            ],
        }
        payloads: list[tuple[str, dict[str, object]]] = []
        game.client.post = lambda path, payload: (  # type: ignore[method-assign]
            payloads.append((path, payload)) or {"ok": True, "events": []}
        )

        actions = game.button_actions(state)
        self.assertEqual([action.label for action in actions], ["Use Amber Charm", "Use Blue Charm"])
        actions[1].callback()
        self.assertEqual(payloads[0][0], "/commands")
        self.assertEqual(payloads[0][1]["offer_id"], "use-b")
        self.assertNotIn("command", payloads[0][1])
        self.assertEqual(
            payloads[0][1]["envelope"]["intent_id"],
            offer_intent_id(42, "use-b"),
        )

    def test_button_game_maps_dealt_craft_and_rest_cards_to_exact_commands(self) -> None:
        game = ButtonGame(CosyClient("http://127.0.0.1:3102"), 42, "session")
        state = {
            "world_id": "world://cosyworld/official",
            "world_seq": 73,
            "actors": [{"id": 42, "canonical_ref": "actor://cosyworld/42"}],
            "action_hand": {"entries": [{"offer_id": "craft-17"}, {"offer_id": "rest-5"}]},
            "action_offers": [
                {
                    "offer_id": "craft-17",
                    "kind": "craft",
                    "accessible_label": "Craft",
                    "command": "craft Brass Lantern",
                    "target": {"kind": "recipe", "label": "Brass Lantern"},
                },
                {
                    "offer_id": "rest-5",
                    "kind": "rest",
                    "accessible_label": "Rest",
                    "command": "rest",
                    "target": {"kind": "location", "label": "The Cosy Cottage"},
                },
            ],
        }
        payloads: list[tuple[str, dict[str, object]]] = []
        game.client.post = lambda path, payload: (  # type: ignore[method-assign]
            payloads.append((path, payload))
            or {"ok": True, "events": [{"seq": 74, "type": "message.created", "content": "done"}]}
        )

        actions = game.button_actions(state)

        self.assertEqual([action.label for action in actions], ["Craft", "Rest"])
        self.assertEqual([action.detail for action in actions], ["Brass Lantern", "The Cosy Cottage"])
        actions[0].callback()
        actions[1].callback()
        self.assertEqual([path for path, _ in payloads], ["/commands", "/commands"])
        self.assertEqual(
            [payload["offer_id"] for _, payload in payloads],
            ["craft-17", "rest-5"],
        )
        for _, payload in payloads:
            self.assertNotIn("command", payload)
        self.assertEqual(
            [payload["envelope"]["intent_id"] for _, payload in payloads],
            [offer_intent_id(42, "craft-17"), offer_intent_id(42, "rest-5")],
        )
        self.assertEqual(game.last_seq, 74)

    def test_button_game_uses_the_story_card_think_certificate_in_render_and_errors(self) -> None:
        game = ButtonGame(CosyClient("http://127.0.0.1:3102"), 42, "session")
        state = {
            "actors": [
                {
                    "id": 42,
                    "name": "Moss Stitch",
                    "hp": 1,
                    "canonical_ref": "actor://cosyworld/42",
                }
            ],
            "action_hand": {
                "entries": [{
                    "slot": "story",
                    "offer_id": "move-7",
                    "think": {
                        "available": True,
                        "free": False,
                        "offer_id": "think:42:focus:story:7:move-7",
                    },
                }],
            },
        }
        game.state = lambda: state  # type: ignore[method-assign]
        game.client.post = lambda _path, _payload: {"ok": False, "status": 409, "events": []}  # type: ignore[method-assign]

        output = io.StringIO()
        with redirect_stdout(output):
            game.render(state, [])
        game.pass_hand()

        self.assertIn(
            "[P]     Think about the Story card (replace only it; uses the turn)",
            output.getvalue(),
        )
        self.assertIn("Think failed with status 409.", game.message_log)


if __name__ == "__main__":
    unittest.main()
