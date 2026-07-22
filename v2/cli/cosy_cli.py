#!/usr/bin/env python3
"""Tiny terminal client for the CosyWorld v2 orchestrator."""

from __future__ import annotations

import argparse
import json
import random
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import termios
    import tty
except ImportError:  # pragma: no cover - non-posix fallback
    termios = None
    tty = None


ABILITIES = ("strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma")
AVATAR_PREFIXES = ("Moss", "Button", "Hearth", "Rain", "Moon", "Thimble", "Lantern", "Brindle")
AVATAR_SUFFIXES = ("Wanderer", "Stitch", "Keeper", "Guest", "Scout", "Dreamer", "Walker", "Friend")
PRESENCE_HEARTBEAT_SECS = 60
HTTP_TIMEOUT_SECS = 25
WORLD_BEAT_PRESENTATION_CONTRACT_VERSION = 1
WORLD_BEAT_TYPES = {
    "world.weather.shifted",
    "world.weather.held",
    "world.trade.flowed",
    "world.trade.disrupted",
    "world.faction.influence_shifted",
    "world.conflict.pressure_grew",
    "world.conflict.pressure_eased",
    "world.conflict.escalated",
}


class ButtonAction:
    def __init__(self, label: str, callback, detail: str = "") -> None:
        self.label = label
        self.callback = callback
        self.detail = detail


class ClientError(RuntimeError):
    pass


class CosyClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def get(self, path: str, query: dict[str, object] | None = None) -> object:
        if query:
            path = f"{path}?{urllib.parse.urlencode(query)}"
        return self._request("GET", path)

    def post(self, path: str, payload: dict[str, object]) -> object:
        return self._request("POST", path, payload)

    def _request(self, method: str, path: str, payload: dict[str, object] | None = None) -> object:
        body = None
        headers = {}
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["content-type"] = "application/json"
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECS) as response:
                raw = response.read().decode("utf-8")
        except TimeoutError as error:
            raise ClientError(f"request to {self.base_url} timed out after {HTTP_TIMEOUT_SECS}s") from error
        except urllib.error.URLError as error:
            raise ClientError(f"cannot reach {self.base_url}: {error}") from error
        try:
            return json.loads(raw)
        except json.JSONDecodeError as error:
            raise ClientError(f"server returned non-json response: {raw[:200]}") from error


class Game:
    def __init__(self, client: CosyClient, actor_id: int | None, actor_session: str | None) -> None:
        self.client = client
        self.actor_id = actor_id
        self.actor_session = actor_session
        self.last_seq = 0
        self._acknowledged_world_beats: set[str] = set()
        self._presence_stop = threading.Event()
        self._presence_thread: threading.Thread | None = None

    def run(self) -> None:
        self.ensure_avatar()
        if self.start_presence_heartbeat():
            print("Presence: active.")
        self.look()
        self.help(short=True)
        while True:
            try:
                command = input("\ncosy> ").strip()
            except (EOFError, KeyboardInterrupt):
                self.leave_presence()
                print("\nbye")
                return

            if not command:
                self.look()
                continue
            try:
                if self.handle(command):
                    return
            except ClientError as error:
                print(f"! {error}")
            except ValueError as error:
                print(f"! {error}")

    def ensure_avatar(self) -> None:
        try:
            health = self.client.get("/health")
        except ClientError:
            raise
        if not isinstance(health, dict) or not health.get("ok"):
            raise ClientError("server health check failed")

        if self.actor_id is not None and not self.actor_session:
            print(f"Actor {self.actor_id} has no session token; creating a new avatar.")
            self.actor_id = None

        if self.actor_id is not None:
            self.ping_presence()
            state = self.state()
            if state.get("primary_action", {}).get("kind") != "create_avatar":
                return
            print(f"Actor {self.actor_id} was not found; creating a new avatar.")
            self.actor_id = None
            self.actor_session = None

        if self.actor_id is None:
            name = input("Avatar name: ").strip() or "Traveler"
            response = self.client.post("/avatar", {"name": name})
            if not isinstance(response, dict) or not response.get("ok"):
                raise ClientError(f"avatar creation failed: {response}")
            actor = response.get("actor") or {}
            self.actor_id = int(actor["id"])
            self.actor_session = str(response.get("actor_session") or "")
            self.print_events(response.get("events") or [])
            print(f"Created {actor.get('name', name)} as actor {self.actor_id}.")

    def handle(self, command: str) -> bool:
        verb, _, rest = command.partition(" ")
        verb = verb.lower()
        rest = rest.strip()

        if verb in {"quit", "exit", "q"}:
            self.leave_presence()
            print("bye")
            return True
        if verb in {"help", "h", "?"}:
            self.help()
        elif verb in {"look", "l"}:
            if rest:
                self.run_command(command)
            else:
                self.look()
        elif verb in {"act", "a"}:
            self.act()
        elif verb == "chat":
            if rest and not first_token_int(rest):
                self.run_command(command)
            else:
                self.chat(rest)
        elif verb in {"say", "\""}:
            self.run_command(f"say {rest}" if verb == "\"" else command)
        elif verb in {"emote", "me", "/me", "report", "drop", "give", "trade", "steal", "bond", "resolve", "skill", "calling", "bank", "listen", "study", "influence", "prepare", "work", "assist", "rest", "search", "deck", "wear", "remove", "wield", "sling", "stow", "unstow", "cast", "bracelet"}:
            self.run_command(command)
        elif verb in {"move", "go"}:
            if rest and not first_token_int(rest):
                self.run_command(command)
            else:
                self.move(rest)
        elif verb in {"pickup", "pick", "take"}:
            if rest and not first_token_int(rest):
                self.run_command(command)
            else:
                self.pick_up(rest)
        elif verb == "use":
            if rest and not all(part.isdigit() for part in rest.split()):
                self.run_command(command)
            else:
                self.use_item(rest)
        elif verb == "check":
            self.check(rest)
        elif verb == "attack":
            if rest and not first_token_int(rest):
                self.run_command(command)
            else:
                self.attack(rest)
        elif verb == "defend":
            self.defend()
        elif verb in {"events", "watch"}:
            self.events(rest)
        elif verb == "who":
            self.who()
        elif verb == "inventory":
            self.inventory()
        else:
            self.run_command(command)
        return False

    def state(self) -> dict[str, object]:
        query: dict[str, object] = {}
        if self.actor_id is not None:
            query["actor_id"] = self.actor_id
        if self.actor_session:
            query["actor_session"] = self.actor_session
        response = self.client.get("/state", query)
        if not isinstance(response, dict):
            raise ClientError("state response was not an object")
        return response

    def look(self) -> None:
        state = self.state()
        location = state.get("location") or {}
        print(f"\n== {location.get('name', 'Unknown')} [{location.get('id', '?')}] ==")
        self.print_exits(state.get("exits") or [])
        self.print_actors(state.get("actors") or [])
        self.print_items(state.get("items") or [])
        self.print_primary_action(state.get("primary_action") or {})
        self.print_action_hand(state.get("action_hand") or [])
        self.remember_events(state.get("recent_events") or [])

    def who(self) -> None:
        self.print_actors(self.state().get("actors") or [])

    def inventory(self) -> None:
        items = [
            item
            for item in self.state().get("items") or []
            if item.get("holder_actor_id") == self.actor_id
        ]
        if not items:
            print("Inventory: empty")
            return
        print("Inventory:")
        for item in items:
            print(f"  {item['id']}: {item['name']} ({item.get('charges', 0)} charge)")

    def act(self) -> None:
        state = self.state()
        options = state.get("primary_action", {}).get("options") or []
        if not options:
            print("No actions available.")
            return
        print("Actions:")
        for index, option in enumerate(options, start=1):
            print(f"  {index}. {option['label']}")
        raw = input("Choose action: ").strip().lower()
        if not raw:
            return
        if raw.isdigit():
            index = int(raw) - 1
            if index < 0 or index >= len(options):
                raise ValueError("action number out of range")
            kind = options[index]["kind"]
        else:
            kind = raw

        if kind == "chat":
            self.choose_chat(state)
        elif kind == "check":
            ability = input(f"Ability [{'/'.join(ABILITIES)}]: ").strip() or "wisdom"
            dc = input("DC [10]: ").strip()
            self.check(f"{ability} {dc}".strip())
        elif kind == "move":
            self.choose_move(state)
        elif kind == "flee":
            self.choose_flee(state)
        elif kind == "pick_up":
            self.choose_pickup(state)
        elif kind == "use_item":
            self.choose_use_item(state)
        elif kind == "give_item":
            self.choose_give_item(state)
        elif kind == "attack":
            self.choose_attack(state)
        elif kind == "defend":
            self.defend()
        else:
            raise ValueError(f"unknown action kind: {kind}")

    def choose_chat(self, state: dict[str, object]) -> None:
        actors = [
            actor
            for actor in state.get("actors") or []
            if actor.get("id") != self.actor_id and actor.get("kind") == "npc"
        ]
        if not actors:
            print("No one is ready to chat here.")
            return
        self.print_actors(actors)
        target_id = self.require_int(input("Target actor: ").strip(), "chat with whom?")
        self.chat_with(target_id)

    def choose_move(self, state: dict[str, object]) -> None:
        exits = state.get("exits") or []
        if not exits:
            print("No exits here.")
            return
        self.print_exits(exits)
        choice = input("Destination: ").strip()
        if choice.isdigit() and not any(int(choice) == exit_["destination_location_id"] for exit_ in exits):
            index = int(choice) - 1
            if 0 <= index < len(exits):
                choice = str(exits[index]["destination_location_id"])
        self.move(choice)

    def choose_flee(self, state: dict[str, object]) -> None:
        exits = [
            exit_
            for exit_ in state.get("exits") or []
            if not exit_.get("locked") and exit_.get("accessible") is not False
        ]
        if not exits:
            print("No escape route here.")
            return
        self.print_exits(exits)
        choice = input("Escape to: ").strip()
        if choice.isdigit() and not any(int(choice) == exit_["destination_location_id"] for exit_ in exits):
            index = int(choice) - 1
            if 0 <= index < len(exits):
                choice = str(exits[index]["destination_location_id"])
        self.flee(self.require_int(choice, "flee where?"))

    def choose_pickup(self, state: dict[str, object]) -> None:
        items = [item for item in state.get("items") or [] if item.get("location_id")]
        if not items:
            print("Nothing to pick up here.")
            return
        self.print_items(items)
        self.pick_up(input("Item: ").strip())

    def choose_use_item(self, state: dict[str, object]) -> None:
        items = [
            item
            for item in state.get("items") or []
            if item.get("holder_actor_id") == self.actor_id
        ]
        if not items:
            print("You are not carrying a usable item.")
            return
        self.print_items(items)
        item_id = input("Item: ").strip()
        target_id = input(f"Target actor [{self.actor_id}]: ").strip()
        self.use_item(f"{item_id} {target_id}".strip())

    def choose_give_item(self, state: dict[str, object]) -> None:
        items = [
            item
            for item in state.get("items") or []
            if item.get("holder_actor_id") == self.actor_id and item.get("kind") == "evolution"
        ]
        actors = [
            actor
            for actor in state.get("actors") or []
            if actor.get("id") != self.actor_id
            and actor.get("kind") == "npc"
            and actor.get("status") == "active"
        ]
        pairs = [
            (item, actor)
            for item in items
            for actor in actors
            if evolution_item_matches_resident(int(item["id"]), int(actor["id"]))
        ]
        if not pairs:
            print("No matching gifts here.")
            return
        for index, (item, actor) in enumerate(pairs, start=1):
            print(f"  {index}. {item['name']} to {actor['name']}")
        choice = self.require_int(input("Gift: ").strip(), "give which item?") - 1
        if choice < 0 or choice >= len(pairs):
            raise ValueError("gift number out of range")
        item, actor = pairs[choice]
        self.give_item(int(item["id"]), int(actor["id"]))


    def choose_attack(self, state: dict[str, object]) -> None:
        actors = [
            actor
            for actor in state.get("actors") or []
            if actor.get("id") != self.actor_id and actor.get("status") == "active"
        ]
        if not actors:
            print("No active targets here.")
            return
        self.print_actors(actors)
        self.attack(input("Target actor: ").strip())

    def chat(self, rest: str) -> None:
        if not rest:
            self.choose_chat(self.state())
            return
        self.chat_with(self.require_int(rest, "chat with whom?"))

    def chat_with(self, target_actor_id: int) -> None:
        self.post_action(
            "/actions/chat",
            {"actor_id": self.actor_id, "target_actor_id": target_actor_id},
        )

    def move(self, rest: str) -> None:
        destination = self.require_int(rest, "move where?")
        self.post_action(
            "/actions/move",
            {"actor_id": self.actor_id, "destination_location_id": destination},
        )

    def pick_up(self, rest: str) -> None:
        item_id = self.require_int(rest, "pick up which item?")
        self.post_action("/actions/pick-up", {"actor_id": self.actor_id, "item_id": item_id})

    def give_item(self, item_id: int, target_actor_id: int) -> None:
        self.post_action(
            "/actions/give-item",
            {"actor_id": self.actor_id, "item_id": item_id, "target_actor_id": target_actor_id},
        )

    def use_item(self, rest: str) -> None:
        parts = rest.split()
        if not parts:
            raise ValueError("use which item?")
        payload = {"actor_id": self.actor_id, "item_id": int(parts[0])}
        if len(parts) > 1:
            payload["target_actor_id"] = int(parts[1])
        self.post_action("/actions/use-item", payload)

    def check(self, rest: str) -> None:
        parts = rest.split()
        ability = parts[0].lower() if parts else "wisdom"
        if ability not in ABILITIES and ability[:3] not in {a[:3] for a in ABILITIES}:
            raise ValueError(f"unknown ability: {ability}")
        payload = {"actor_id": self.actor_id, "ability": ability}
        if len(parts) > 1:
            payload["dc"] = int(parts[1])
        self.post_action("/actions/check", payload)

    def attack(self, rest: str) -> None:
        target_id = self.require_int(rest, "attack which actor?")
        self.post_action(
            "/actions/attack",
            {"actor_id": self.actor_id, "target_actor_id": target_id},
        )

    def defend(self) -> None:
        self.post_action("/actions/defend", {"actor_id": self.actor_id})

    def flee(self, destination_id: int) -> None:
        self.post_action(
            "/actions/flee",
            {"actor_id": self.actor_id, "destination_location_id": destination_id},
        )

    def events(self, rest: str) -> None:
        after = int(rest) if rest else self.last_seq
        query: dict[str, object] = {"after": after}
        if self.actor_id is not None:
            query["actor_id"] = self.actor_id
        if self.actor_session:
            query["actor_session"] = self.actor_session
        response = self.client.get("/events", query)
        if not isinstance(response, dict):
            raise ClientError("events response was not an object")
        events = response.get("events") or []
        if not isinstance(events, list):
            raise ClientError("events response did not contain an event list")
        self.last_seq = max(self.last_seq, int(response.get("next_after") or 0))
        if not events:
            print("No new room events.")
            return
        self.print_events(events)

    def run_command(self, command: str) -> None:
        if self.actor_id is None:
            raise ClientError("command requires an avatar")
        response = self.client.post(
            "/commands",
            self.with_actor_session({"actor_id": self.actor_id, "command": command}),
        )
        if not isinstance(response, dict):
            raise ClientError("command response was not an object")
        output = response.get("output")
        if output:
            print(str(output))
        self.print_events(response.get("events") or [])
        if not response.get("ok") and not output:
            print(f"Command failed with status {response.get('status')}.")

    def post_action(self, path: str, payload: dict[str, object]) -> None:
        authoritative_payload = self.with_actor_session(payload)
        offer = self.current_offer(path, authoritative_payload)
        if offer:
            response = self.client.post(
                "/actions/submit",
                {
                    "path": path,
                    "offer_id": offer.get("offer_id"),
                    "kind": offer.get("kind"),
                    "rules_action": offer.get("rules_action"),
                    "operation": offer.get("operation"),
                    "rules_profile": offer.get("rules_profile"),
                    "state_revision": offer.get("state_revision"),
                    "target": offer.get("target"),
                    "cost": offer.get("cost"),
                    "payload": authoritative_payload,
                },
            )
        else:
            response = self.client.post(path, authoritative_payload)
        if not isinstance(response, dict):
            raise ClientError("action response was not an object")
        self.print_events(response.get("events") or [])
        if not response.get("ok"):
            print(f"Action failed with status {response.get('status')}.")
        else:
            self.look()

    def current_offer(self, path: str, payload: dict[str, object]) -> dict[str, object] | None:
        kinds_by_path = {
            "/actions/chat": {"chat"},
            "/actions/move": {"move"},
            "/actions/flee": {"flee"},
            "/actions/check": {"check"},
            "/actions/study": {"study"},
            "/actions/influence": {"influence"},
            "/actions/cast-spell": {"cast_spell"},
            "/actions/pick-up": {"pick_up"},
            "/actions/drop": {"drop_item"},
            "/actions/use-item": {"use_item", "use_feature"},
            "/actions/give-item": {"give_item"},
            "/actions/trade-item": {"trade_item"},
            "/actions/theft": {"theft"},
            "/actions/craft": {"craft"},
            "/actions/attack": {"attack"},
            "/actions/defend": {"defend"},
            "/actions/prepare": {"prepare"},
            "/actions/work": {"work"},
            "/actions/help": {"help"},
            "/actions/rest": {"rest"},
            "/actions/bank-ledger": {"bank_ledger"},
            "/actions/unlock-charm-slot": {"unlock_charm_slot"},
            "/actions/create-bond": {"create_bond"},
            "/actions/resolve-bond": {"resolve_bond"},
        }
        kinds = kinds_by_path.get(path)
        if not kinds:
            return None
        offers = [
            offer
            for offer in self.state().get("action_offers") or []
            if offer.get("kind") in kinds and not offer.get("disabled")
        ]
        for offer in offers:
            target = offer.get("target") or {}
            expected = target.get("id")
            key = {
                "location": "destination_location_id",
                "actor": "target_actor_id",
                "item": "target_item_id" if path in {"/actions/trade-item", "/actions/theft"} else "item_id",
                "recipe": "recipe_id",
            }.get(str(target.get("kind") or ""))
            submitted = payload.get(key) if key else None
            if not submitted or not expected or int(submitted) == int(expected):
                return offer
        return None

    def print_exits(self, exits: list[dict[str, object]]) -> None:
        if not exits:
            print("Exits: none")
            return
        print("Exits:")
        for index, exit_ in enumerate(exits, start=1):
            locked = " locked" if exit_.get("locked") else ""
            print(
                f"  {index}. {exit_['destination_location_name']} "
                f"[{exit_['destination_location_id']}]{locked}"
            )

    def print_actors(self, actors: list[dict[str, object]]) -> None:
        if not actors:
            print("Actors: none")
            return
        print("Actors:")
        for actor in actors:
            marker = " you" if actor.get("id") == self.actor_id else ""
            print(
                f"  {actor['id']}: {actor['name']} "
                f"({actor['kind']}, hp {actor['hp']}, lvl {actor['stats']['level']}){marker}"
            )

    def print_items(self, items: list[dict[str, object]]) -> None:
        visible = [
            item
            for item in items
            if item.get("location_id") or item.get("holder_actor_id") == self.actor_id
        ]
        if not visible:
            print("Items: none")
            return
        print("Items:")
        for item in visible:
            where = "carried" if item.get("holder_actor_id") == self.actor_id else "here"
            print(f"  {item['id']}: {item['name']} ({where}, {item.get('charges', 0)} charge)")

    def print_primary_action(self, action: dict[str, object]) -> None:
        options = action.get("options") or []
        option_labels = ", ".join(option["label"] for option in options) or "none"
        print(f"Button: {action.get('label', 'Wait')} [{option_labels}]")

    def print_action_hand(self, offers: object) -> None:
        if isinstance(offers, dict):
            offers = offers.get("entries") or []
        if not isinstance(offers, list):
            return
        offers = [offer for offer in offers if isinstance(offer, dict)]
        if not offers:
            return
        labels = ", ".join(str(offer.get("label") or offer.get("kind") or "action") for offer in offers)
        print(f"Hand: {labels}")

    def print_events(self, events: list[dict[str, object]]) -> None:
        if not events:
            return
        self.last_seq = max(
            self.last_seq,
            *(int(event.get("seq") or 0) for event in events),
        )
        for event in events:
            if event_is_hidden_context(event):
                continue
            print(self.format_event(event))
            if world_beat_is_renderable(event):
                sys.stdout.flush()
            self.acknowledge_world_beat(event)

    def acknowledge_world_beat(self, event: dict[str, object]) -> None:
        if self.actor_id is None or not self.actor_session or not world_beat_is_renderable(event):
            return
        seq = int(event.get("seq") or 0)
        exposure_id = f"world-beat:v{WORLD_BEAT_PRESENTATION_CONTRACT_VERSION}:{seq}"
        if exposure_id in self._acknowledged_world_beats:
            return
        try:
            response = self.client.post(
                "/story/world-beat-exposures",
                {
                    "actor_id": self.actor_id,
                    "actor_session": self.actor_session,
                    "exposure_id": exposure_id,
                    "transport": "cli",
                    "state_revision": max(self.last_seq, seq),
                },
            )
        except ClientError:
            return
        if isinstance(response, dict) and response.get("ok"):
            self._acknowledged_world_beats.add(exposure_id)

    def remember_events(self, events: list[dict[str, object]]) -> None:
        for event in events:
            self.last_seq = max(self.last_seq, int(event.get("seq") or 0))

    def format_event(self, event: dict[str, object]) -> str:
        seq = event.get("seq")
        type_name = event.get("type")
        actor = event.get("actor_name") or actor_label(event.get("actor_id"))
        location = event.get("location_name") or location_label(event.get("location_id"))
        destination = event.get("destination_location_name") or location_label(
            event.get("destination_location_id")
        )

        if type_name == "message.created":
            return f"[{seq}] {actor}: {event.get('content', '')}"
        if type_name == "world.reset":
            return f"[{seq}] The world returns to its first page."
        if type_name in WORLD_BEAT_TYPES:
            return f"[{seq}] ✦ {str(event.get('content') or '').strip()}"
        if type_name == "actor.created":
            return f"[{seq}] {actor} enters the world at {location}."
        if type_name == "actor.entered_location":
            return f"[{seq}] {actor} is in {location}."
        if type_name == "actor.moved":
            return f"[{seq}] {actor} moves from {location} to {destination}."
        if type_name == "move.blocked":
            return f"[{seq}] {actor} cannot move from {location} to {destination}."
        if type_name == "item.picked_up":
            return f"[{seq}] {actor} picks up {event.get('item_name') or 'an item'}."
        if type_name == "item.dropped":
            return f"[{seq}] {actor} drops {event.get('item_name') or 'an item'}."
        if type_name == "item.used":
            target = event.get("target_actor_name") or actor
            return f"[{seq}] {actor} uses {event.get('item_name') or 'an item'} on {target}."
        if type_name == "item.given":
            target = event.get("target_actor_name") or "someone"
            return f"[{seq}] {actor} gives {event.get('item_name') or 'an item'} to {target}."
        if type_name == "avatar.evolved":
            target = event.get("target_actor_name") or "Someone"
            return f"[{seq}] {target} evolves to level {event.get('total') or 2}."
        if type_name == "branch.opened":
            target = event.get("target_actor_name") or "someone"
            return f"[{seq}] {actor} opens a choice with {target}."
        if type_name == "branch.resolved":
            target = event.get("target_actor_name") or "someone"
            return f"[{seq}] {actor} settles a choice with {target}."
        if type_name == "branch.expired":
            target = event.get("target_actor_name") or "someone"
            return f"[{seq}] {actor} lets a choice with {target} fade."
        if type_name == "ability_check.rolled":
            outcome = "succeeds" if event.get("success") else "fails"
            return (
                f"[{seq}] {actor} {outcome} a check at {event.get('total')} "
                f"vs DC {event.get('dc')}."
            )
        if type_name == "clock.updated":
            return (
                f"[{seq}] {event.get('clock_label') or 'A room clock'} advances to "
                f"{event.get('clock_filled') or 0}/{event.get('clock_segments') or 0}."
            )
        if type_name == "tag.applied":
            return f"[{seq}] {location} gains {event.get('tag_label') or 'a condition'}."
        if type_name == "tag.cleared":
            return f"[{seq}] {location} clears {event.get('tag_label') or 'a condition'}."
        if type_name == "calling.set":
            return f"[{seq}] {actor} sets a Calling: {event_label_tail(event)}."
        if type_name == "calling.revised":
            return f"[{seq}] {actor} revises their Calling: {event_label_tail(event)}."
        if type_name == "ledger.marked":
            return f"[{seq}] {actor} marks the Visit Ledger: {event_label_tail(event)}."
        if type_name == "ledger.banked":
            return f"[{seq}] {actor} banks the Visit Ledger: {event_label_tail(event)}."
        if type_name == "bond.created":
            target = event.get("target_actor_name") or "someone"
            return f"[{seq}] {actor} writes a Bond with {target}."
        if type_name == "bond.revised":
            target = event.get("target_actor_name") or "someone"
            return f"[{seq}] {actor} revises a Bond with {target}."
        if type_name == "bond.deepened":
            target = event.get("target_actor_name") or "someone"
            return f"[{seq}] {actor} deepens a Bond with {target}."
        if type_name == "bond.resolved":
            target = event.get("target_actor_name") or "someone"
            return f"[{seq}] {actor} settles a Bond with {target}."
        if type_name == "combat.defend":
            return f"[{seq}] {actor} defends."
        if type_name == "combat.attack.attempt":
            target = event.get("target_actor_name") or "someone"
            return f"[{seq}] {actor} attacks {target}: {event.get('total')} vs AC {event.get('dc')}."
        if type_name == "combat.attack.hit":
            target = event.get("target_actor_name") or "someone"
            return (
                f"[{seq}] {actor} hits {target} for {event.get('damage')} damage; "
                f"{event.get('current_hp')} HP remains."
            )
        if type_name == "combat.attack.miss":
            target = event.get("target_actor_name") or "someone"
            return f"[{seq}] {actor} misses {target}."
        if type_name == "combat.knockout":
            target = event.get("target_actor_name") or "someone"
            return f"[{seq}] {target} is knocked out."
        if type_name == "combat.flee.success":
            return f"[{seq}] {actor} flees from {location} to {destination}."
        if type_name == "rule.rejected":
            return f"[{seq}] Rule rejected for {actor} (reason {event.get('reason')})."
        return f"[{seq}] {type_name}: {event}"

    def with_actor_session(self, payload: dict[str, object]) -> dict[str, object]:
        next_payload = dict(payload)
        if self.actor_session:
            next_payload["actor_session"] = self.actor_session
        return next_payload

    def leave_presence(self) -> None:
        if self.actor_id is None or not self.actor_session:
            return
        self.stop_presence_heartbeat()
        try:
            self.client.post("/presence/leave", self.with_actor_session({"actor_id": self.actor_id}))
        except ClientError:
            pass

    def ping_presence(self) -> dict[str, object] | None:
        if self.actor_id is None or not self.actor_session:
            return None
        response = self.client.post(
            "/presence/ping",
            self.with_actor_session({"actor_id": self.actor_id}),
        )
        if not isinstance(response, dict) or not response.get("ok"):
            raise ClientError(f"presence ping failed: {response}")
        return response

    def start_presence_heartbeat(self) -> bool:
        if self.actor_id is None or not self.actor_session or self._presence_thread:
            return False
        try:
            self.ping_presence()
        except ClientError:
            return False
        self._presence_stop.clear()

        def heartbeat() -> None:
            while not self._presence_stop.wait(PRESENCE_HEARTBEAT_SECS):
                try:
                    self.ping_presence()
                except ClientError:
                    return

        self._presence_thread = threading.Thread(target=heartbeat, daemon=True)
        self._presence_thread.start()
        return True

    def stop_presence_heartbeat(self) -> None:
        self._presence_stop.set()
        thread = self._presence_thread
        if thread and thread.is_alive() and threading.current_thread() is not thread:
            thread.join(timeout=1)
        self._presence_thread = None

    def help(self, short: bool = False) -> None:
        if short:
            print("Type 'act' for the one-button menu, 'say <message>', 'look', or 'help'.")
            return
        print(
            "Commands: act, look, who, deck, inventory, say <message>, /me <action>, "
            "chat/influence <resident>, listen, search <feature>, study <subject>, "
            "go <location|direction>, take/drop/give/trade/steal <item>, use <item> [target], "
            "wear/remove <charm>, wield/sling <weapon>, stow <item> in <bag>, unstow <item>, "
            "prepare spell <spell>, cast <spell> [target], bracelet unlock, prepare/work/assist/rest, "
            "attack <actor>, defend, report <actor>: <reason>, events/watch [after_seq], quit"
        )

    @staticmethod
    def require_int(value: str, message: str) -> int:
        value = value.strip()
        if not value:
            raise ValueError(message)
        return int(value.split()[0])


class ButtonGame(Game):
    def __init__(self, client: CosyClient, actor_id: int | None, actor_session: str | None) -> None:
        super().__init__(client, actor_id, actor_session)
        self.rotation = 0
        self.message_log: list[str] = []
        self.pending_world_beat_events: list[dict[str, object]] = []

    def run(self) -> None:
        self.ensure_avatar()
        self.start_presence_heartbeat()
        while True:
            try:
                state = self.state()
                actions = self.button_actions(state)
                self.render(state, actions)
                key = read_key()
                if key in {"q", "Q", "\x03"}:
                    self.leave_presence()
                    print("\nbye")
                    return
                if key in {"\t", "s", "S"}:
                    self.rotation = (self.rotation + 1) % max(1, len(actions))
                    continue
                if key in {" ", "2"} and len(actions) > 1:
                    actions[1].callback()
                    continue
                if key in {"\r", "\n", "1", ""} and actions:
                    actions[0].callback()
                    continue
            except ClientError as error:
                print(f"! {error}")
                time.sleep(1.5)
            except ValueError as error:
                print(f"! {error}")
                time.sleep(1.5)

    def ensure_avatar(self) -> None:
        health = self.client.get("/health")
        if not isinstance(health, dict) or not health.get("ok"):
            raise ClientError("server health check failed")

        if self.actor_id is not None and not self.actor_session:
            self.actor_id = None

        if self.actor_id is not None:
            self.ping_presence()
            state = self.state()
            if state.get("primary_action", {}).get("kind") != "create_avatar":
                return
            self.actor_id = None
            self.actor_session = None

        if self.actor_id is None:
            name = generated_avatar_name()
            response = self.client.post("/avatar", {"name": name})
            if not isinstance(response, dict) or not response.get("ok"):
                raise ClientError(f"avatar creation failed: {response}")
            actor = response.get("actor") or {}
            self.actor_id = int(actor["id"])
            self.actor_session = str(response.get("actor_session") or "")
            self.capture_events(response.get("events") or [])
            self.message_log.append(f"Generated avatar: {actor.get('name', name)} [{self.actor_id}]")

    def button_actions(self, state: dict[str, object]) -> list[ButtonAction]:
        candidates: list[ButtonAction] = []
        actors = state.get("actors") or []
        items = state.get("items") or []
        exits = state.get("exits") or []
        options = state.get("primary_action", {}).get("options") or []
        option_kinds = {option.get("kind") for option in options}
        held_evolution_items = [
            item
            for item in items
            if item.get("holder_actor_id") == self.actor_id and item.get("kind") == "evolution"
        ]
        resident_targets = [
            actor
            for actor in actors
            if actor.get("id") != self.actor_id
            and actor.get("kind") == "npc"
            and actor.get("status") == "active"
        ]

        if "give_item" in option_kinds:
            for target in resident_targets:
                target_id = int(target["id"])
                for item in held_evolution_items:
                    item_id = int(item["id"])
                    if not evolution_item_matches_resident(item_id, target_id):
                        continue
                    candidates.append(
                        ButtonAction(
                            f"Give: {item['name']}",
                            lambda item_id=item_id, target_id=target_id: self.give_item(
                                item_id, target_id
                            ),
                            f"To {target['name']}.",
                        )
                    )

        for actor in actors:
            if actor.get("id") == self.actor_id or actor.get("kind") != "npc":
                continue
            actor_id = int(actor["id"])
            name = str(actor["name"])
            candidates.append(
                ButtonAction(
                    f"Chat: {name}",
                    lambda actor_id=actor_id: self.chat_with(actor_id),
                    "Let your avatar speak.",
                )
            )

        if "pick_up" in option_kinds:
            for item in items:
                if item.get("location_id"):
                    item_id = int(item["id"])
                    candidates.append(
                        ButtonAction(
                            f"Take: {item['name']}",
                            lambda item_id=item_id: self.pick_up(str(item_id)),
                            "Gather the item here.",
                        )
                    )

        escaping = "flee" in option_kinds
        if escaping or "move" in option_kinds:
            for exit_ in exits:
                if exit_.get("locked") or exit_.get("accessible") is False:
                    continue
                destination_id = int(exit_["destination_location_id"])
                callback = (
                    (lambda destination_id=destination_id: self.flee(destination_id))
                    if escaping
                    else (lambda destination_id=destination_id: self.move(str(destination_id)))
                )
                candidates.append(
                    ButtonAction(
                        f"{'Flee' if escaping else 'Go'}: {exit_['destination_location_name']}",
                        callback,
                        "Escape the combat room." if escaping else "Travel to the next location.",
                    )
                )

        if "use_item" in option_kinds:
            for item in items:
                if item.get("holder_actor_id") == self.actor_id:
                    item_id = int(item["id"])
                    candidates.append(
                        ButtonAction(
                            f"Use: {item['name']}",
                            lambda item_id=item_id: self.use_item(str(item_id)),
                            "Use the carried item.",
                        )
                    )

        if "attack" in option_kinds:
            for actor in actors:
                if actor.get("id") != self.actor_id and actor.get("status") == "active":
                    target_id = int(actor["id"])
                    candidates.append(
                        ButtonAction(
                            f"Attack: {actor['name']}",
                            lambda target_id=target_id: self.attack(str(target_id)),
                            "Make a melee attack.",
                        )
                    )

        if "defend" in option_kinds:
            candidates.append(ButtonAction("Defend", self.defend, "Brace for trouble."))

        if "check" in option_kinds:
            candidates.append(
                ButtonAction(
                    "Check: Wisdom",
                    lambda: self.check("wisdom 12"),
                    "Read the room with a Wisdom check.",
                )
            )

        if not candidates:
            candidates.append(ButtonAction("Wait", lambda: None, "Nothing calls for action."))

        rotation = self.rotation % len(candidates)
        return candidates[rotation:] + candidates[:rotation]

    def render(self, state: dict[str, object], actions: list[ButtonAction]) -> None:
        if sys.stdout.isatty():
            print("\033[2J\033[H", end="")
        location = state.get("location") or {}
        print(f"CosyWorld 2.0")
        print(f"{location.get('name', 'Unknown')} [{location.get('id', '?')}]")
        print("=" * 48)
        self.render_actors(state.get("actors") or [])
        self.render_items(state.get("items") or [])
        self.render_exits(state.get("exits") or [])
        print("-" * 48)
        for line in self.message_log[-5:]:
            print(line)
        sys.stdout.flush()
        for event in self.pending_world_beat_events:
            self.acknowledge_world_beat(event)
        self.pending_world_beat_events = [
            event
            for event in self.pending_world_beat_events
            if f"world-beat:v{WORLD_BEAT_PRESENTATION_CONTRACT_VERSION}:{int(event.get('seq') or 0)}"
            not in self._acknowledged_world_beats
        ][-20:]
        print("-" * 48)
        primary = actions[0] if actions else ButtonAction("Wait", lambda: None)
        secondary = actions[1] if len(actions) > 1 else None
        print(f"[Enter] {primary.label}")
        if primary.detail:
            print(f"        {primary.detail}")
        if secondary:
            print(f"[Space] {secondary.label}")
            if secondary.detail:
                print(f"        {secondary.detail}")
        if len(actions) > 2:
            print("[Tab]   More")
        print("[Q]     Quit")

    def render_actors(self, actors: list[dict[str, object]]) -> None:
        others = []
        for actor in actors:
            suffix = "you" if actor.get("id") == self.actor_id else actor.get("kind")
            others.append(f"{actor['name']} ({suffix}, hp {actor['hp']})")
        print("Here: " + (", ".join(others) if others else "nobody"))

    def render_items(self, items: list[dict[str, object]]) -> None:
        visible = []
        for item in items:
            if item.get("location_id"):
                visible.append(str(item["name"]))
            elif item.get("holder_actor_id") == self.actor_id:
                visible.append(f"{item['name']} (carried)")
        print("Items: " + (", ".join(visible) if visible else "none"))

    def render_exits(self, exits: list[dict[str, object]]) -> None:
        visible = []
        for exit_ in exits:
            locked = " locked" if exit_.get("locked") else ""
            visible.append(f"{exit_['destination_location_name']}{locked}")
        print("Paths: " + (", ".join(visible) if visible else "none"))

    def post_action(self, path: str, payload: dict[str, object]) -> None:
        response = self.client.post(path, self.with_actor_session(payload))
        if not isinstance(response, dict):
            raise ClientError("action response was not an object")
        self.capture_events(response.get("events") or [])
        if not response.get("ok"):
            self.message_log.append(f"Action failed with status {response.get('status')}.")
        self.rotation = 0

    def capture_events(self, events: list[dict[str, object]]) -> None:
        if not events:
            return
        self.last_seq = max(
            self.last_seq,
            *(int(event.get("seq") or 0) for event in events),
        )
        for event in events:
            if event_is_hidden_context(event):
                continue
            self.message_log.append(self.format_event(event))
            if world_beat_is_renderable(event):
                self.pending_world_beat_events.append(event)
        self.message_log = self.message_log[-20:]


def actor_label(actor_id: object) -> str:
    return f"Actor {actor_id}" if actor_id else "Someone"


def location_label(location_id: object) -> str:
    return f"Location {location_id}" if location_id else "somewhere"


def event_is_hidden_context(event: dict[str, object]) -> bool:
    return event.get("type") in {"world.bootstrapped", "actor.presence"}


def world_beat_is_renderable(event: dict[str, object]) -> bool:
    return (
        event.get("type") in WORLD_BEAT_TYPES
        and event.get("success") is True
        and int(event.get("seq") or 0) > 0
        and event.get("location_id") is not None
        and bool(str(event.get("content") or "").strip())
    )


def event_label_tail(event: dict[str, object]) -> str:
    content = str(event.get("content") or "").strip()
    if not content:
        return "something changes"
    parts = content.split(":")
    return (parts[1] if len(parts) > 1 else parts[0]).strip() or content


def first_token_int(value: str) -> int | None:
    value = value.strip()
    if not value:
        return None
    token = value.split()[0]
    try:
        return int(token)
    except ValueError:
        return None


def generated_avatar_name() -> str:
    rng = random.SystemRandom()
    return f"{rng.choice(AVATAR_PREFIXES)} {rng.choice(AVATAR_SUFFIXES)}"


def evolution_item_matches_resident(item_id: int, actor_id: int) -> bool:
    if actor_id == 1001:
        return item_id in {2004, 2005}
    if actor_id == 1002:
        return item_id in {2002, 2003}
    if actor_id == 1003:
        return item_id in {2006, 2007}
    return False


def read_key() -> str:
    if not sys.stdin.isatty() or termios is None or tty is None:
        return sys.stdin.read(1) or "q"
    fd = sys.stdin.fileno()
    old_settings = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        key = sys.stdin.read(1)
        if key == "\x1b":
            extra = sys.stdin.read(2)
            if extra in {"[C", "[B"}:
                return "\t"
            if extra in {"[D", "[A"}:
                return " "
        return key
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Play CosyWorld v2 from a terminal.")
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:3102",
        help="CosyWorld v2 orchestrator URL",
    )
    parser.add_argument("--actor-id", type=int, help="Reuse an existing actor id")
    parser.add_argument("--actor-session", help="Actor session token for an existing actor")
    parser.add_argument(
        "--command-mode",
        action="store_true",
        help="Use the typed debug command shell instead of the default button UI",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        game_class = Game if args.command_mode else ButtonGame
        game_class(CosyClient(args.base_url), args.actor_id, args.actor_session).run()
    except ClientError as error:
        print(f"! {error}", file=sys.stderr)
        print("Start the v2 server first: cd v2/orchestrator-rust && cargo run", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
