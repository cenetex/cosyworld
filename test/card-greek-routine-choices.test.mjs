import { expect, it } from "vitest";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { claimsIn } from "../v2/card-game/claims.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const PACK = "greek-drama";
const scenes = [
  {
    work: "aeschylus-prometheus-bound",
    place: "greek-scythian-crag",
    labels: [
      "Send Io with the directions",
      "Mark the fork for later travelers",
    ],
    aftermaths: [null, "greek-crag-fork-marker"],
    formerlySpent: "first",
  },
];

it.each(scenes)(
  "keeps both $work decisions and their records without a carried prop",
  ({ work, place, labels, aftermaths, formerlySpent }) => {
    const stem = `greek-story-${work}`;
    const prop = `${stem}-object`;
    const record = `${stem}-record`;
    const answers = (world) =>
      legalActions(world).filter(
        (a) => a.kind === "choose" && a.choiceId.startsWith(`${stem}-`),
      );
    const world = greekStart();
    world.actors.vale.place = place;
    world.actors.vale.visited.push(place);
    expect(answers(world)).toEqual([]);
    expect(world.items[prop]).toBeUndefined();
    expect(entityActive(world, record)).toBe(false);

    const heard = traveler(world).talk(`${stem}-first`);
    expect(answers(heard.s).map((a) => a.label)).toEqual(labels);
    const away = heard.fork();
    away.s.actors.vale.place = "greek-harbor";
    expect(answers(away.s)).toEqual([]);

    for (const [index, branch] of ["first", "second"].entries()) {
      const choiceId = `${stem}-${branch}-answer`;
      const subject = `${stem}-${branch}`;
      const { action } = cardPlay(heard.s, [subject]);
      expect(action).toMatchObject({
        kind: "choose",
        choiceId,
        target: subject,
        label: labels[index],
      });
      const settled = heard.fork().act("choose", { choiceId });
      expect(settled.hands()).toEqual(heard.hands());
      const committed = settled.s.packs[PACK];
      expect(committed.choices[`${stem}-outcome`]).toBe(branch);
      expect(committed.receipts[choiceId]).toBe(settled.s.turn);
      expect(answers(settled.s)).toEqual([]);
      expect(play(settled.s, action).ok).toBe(false);
      expect(entityActive(settled.s, record)).toBe(true);
      const claims = claimsIn(record, settled.s);
      expect(claims.map((claim) => claim.claim)).toEqual([choiceId]);
      for (const [other, id] of aftermaths.entries())
        if (id) expect(entityActive(settled.s, id)).toBe(index === other);
      if (aftermaths[index])
        expect(legalActions(settled.s)).toContainEqual(
          expect.objectContaining({ kind: "read", item: aftermaths[index] }),
        );

      // Revision 42 logged the same result as a gift and kept or spent its prop.
      const old = structuredClone(settled.s);
      old.packs[PACK].revision = 42;
      old.items[prop] = { holder: place, history: [] };
      const gift = old.log.find((entry) => entry.choiceId === choiceId);
      Object.assign(gift, { verb: "give", itemId: prop, accepted: true });
      delete gift.packId;
      delete gift.choiceId;
      if (branch === formerlySpent) {
        old.usedUp = [...old.usedUp, prop].sort();
        old.gone = [...(old.gone || []), prop].sort();
        gift.gone = [prop];
      }
      const loaded = decodeSave(JSON.stringify(old));
      expect(loaded.packs[PACK].revision).toBe(packDefinition(PACK).revision);
      expect(loaded.packs[PACK].choices).toEqual(committed.choices);
      expect(loaded.packs[PACK].receipts).toEqual(committed.receipts);
      expect(loaded.items[prop]).toBeUndefined();
      const history = loaded.log.find((entry) => entry.seq === gift.seq);
      expect(history).toMatchObject({
        kind: "narration",
        text: gift.text,
        turn: gift.turn,
        targetId: subject,
      });
      expect(history).not.toHaveProperty("itemId");
      expect(claimsIn(record, loaded)).toEqual(claims);
      expect(decodeSave(encodeSave(loaded))).toEqual(loaded);
    }
  },
);
