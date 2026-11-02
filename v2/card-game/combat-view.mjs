// Play standoff beats on the stage: telegraph, cut, strike, resolve pips,
// floating outcome words and the defeat card. Presentation only; the rules
// already committed every result before the first beat starts.
import { nameOf } from "./world.mjs";
import { scaresEnabled } from "./transitions.mjs";
import { imageUrl } from "./images.mjs";
import {
  combatPortrait,
  createCombatPortraits,
  showCombatPortrait,
} from "./combat-portraits.mjs";
import {
  BEAT_MS,
  MAX_RESOLVE,
  createBeatRunner,
  defeatSummary,
  inSentence,
  outcomeWord,
  telegraphText,
} from "./combat-beats.mjs";

const SPEED_KEY = "cosyworld.combat-speed";

export function combatSpeed() {
  try {
    return localStorage.getItem(SPEED_KEY) === "2" ? 2 : 1;
  } catch {
    return 1;
  }
}
export function installCombatSpeed(button) {
  if (!button) return;
  const show = () => {
    const speed = combatSpeed();
    button.textContent = `Fight speed: ${speed}×`;
    button.setAttribute("aria-pressed", String(speed === 2));
  };
  button.onclick = () => {
    try {
      localStorage.setItem(SPEED_KEY, combatSpeed() === 2 ? "1" : "2");
    } catch {}
    show();
  };
  show();
}

// Fighters in a standoff here keep their resolve under them between plays.
export function renderStandingResolve(cast, world, locationId) {
  const standing = new Map();
  const guarding = new Set();
  for (const c of world.standoffs || [])
    if (c.location === locationId)
      for (const id of Object.keys(c.resolve || {})) {
        standing.set(id, c.resolve?.[id] ?? MAX_RESOLVE);
        if (c.guarding?.[id]) guarding.add(id);
      }
  for (const figure of cast.children) {
    delete figure.dataset.combatArt;
    if (guarding.has(figure.dataset.avatar)) {
      const source = figure.querySelector(".portrait-body > img")?.dataset
        .source;
      showCombatPortrait(
        figure,
        combatPortrait(
          figure.dataset.avatar,
          "guard",
          source,
          figure.dataset.facing,
        ),
        "guard",
      );
    }
    const value = standing.get(figure.dataset.avatar);
    let bar = figure.querySelector(":scope > .combat-pips");
    if (value === undefined) {
      bar?.remove();
      continue;
    }
    if (!bar) {
      bar = document.createElement("span");
      bar.className = "combat-pips";
      bar.setAttribute("role", "img");
      for (const part of ["ghost", "fill"]) {
        const layer = document.createElement("span");
        layer.className = `combat-pips-${part}`;
        bar.append(layer);
      }
      figure.append(bar);
    }
    bar.dataset.resolve = String(value);
    bar.setAttribute(
      "aria-label",
      `${nameOf(figure.dataset.avatar)}: ${value} of ${MAX_RESOLVE} resolve`,
    );
    for (const layer of bar.children)
      layer.style.width = `${(100 * value) / MAX_RESOLVE}%`;
  }
}

const ICONS = {
  threaten:
    '<path d="M32 6 58 54H6z"/><path d="M32 24v14M32 44v4" stroke-linecap="round"/>',
  guard: '<path d="M32 6 54 14v16c0 14-10 24-22 28C20 54 10 44 10 30V14z"/>',
  intercept:
    '<path d="M32 6 54 14v16c0 14-10 24-22 28C20 54 10 44 10 30V14z"/><path d="M22 32h20M34 24l8 8-8 8"/>',
  attack:
    '<path d="M12 52 44 20M44 20l6-10 4 4-10 6M20 44l-6 6M52 52 20 20M20 20l-6-10-4 4 10 6M44 44l6 6"/>',
};

function svgIcon(kind) {
  const holder = document.createElement("span");
  holder.className = "combat-telegraph";
  holder.dataset.verb = kind;
  holder.setAttribute("aria-hidden", "true");
  holder.innerHTML = `<svg viewBox="0 0 64 64">${ICONS[kind] || ICONS.attack}</svg>`;
  return holder;
}

export function createCombatView({
  stage,
  caption,
  announce,
  reducedMotion,
  revealLine,
  dialog,
}) {
  let animations = [],
    added = [],
    speed = 1,
    cut = null,
    portraitRun = 0;
  const reduced = () => reducedMotion.matches;
  // Painted stage residents keep their sprite; their beats use the caption.
  const fighter = (id) =>
    id ? stage.querySelector(`#cast [data-avatar="${CSS.escape(id)}"]`) : null;
  const bodyOf = (el) => el?.querySelector(".portrait-body") || el;
  const portraits = createCombatPortraits(fighter);
  const track = (animation) => {
    animation.playbackRate = speed;
    animations.push(animation);
    return animation;
  };
  const animate = (el, frames, options) =>
    el?.animate ? track(el.animate(frames, options)) : null;
  const add = (parent, el) => {
    if (!parent) return el;
    parent.append(el);
    added.push(el);
    return el;
  };
  const setCaption = (text) => {
    caption.textContent = text;
    caption.hidden = !text;
  };
  const pips = (id) => {
    const el = fighter(id);
    if (!el) return null;
    let bar = el.querySelector(":scope > .combat-pips");
    if (!bar) {
      bar = document.createElement("span");
      bar.className = "combat-pips";
      bar.setAttribute("role", "img");
      for (const part of ["ghost", "fill"]) {
        const layer = document.createElement("span");
        layer.className = `combat-pips-${part}`;
        bar.append(layer);
      }
      add(el, bar);
    }
    return bar;
  };
  const showResolve = (id, value, from = value) => {
    const bar = pips(id);
    if (!bar) return;
    const width = (v) => `${(100 * Math.max(0, v)) / MAX_RESOLVE}%`;
    bar.setAttribute("aria-label", `${nameOf(id)}: ${value} resolve`);
    bar.dataset.resolve = String(value);
    const fill = bar.querySelector(".combat-pips-fill"),
      ghost = bar.querySelector(".combat-pips-ghost");
    fill.style.width = width(value);
    ghost.style.width = width(value);
    if (from === value || reduced()) return;
    animate(fill, [{ width: width(from) }, { width: width(value) }], {
      duration: BEAT_MS.drain,
      easing: "ease-out",
    });
    animate(ghost, [{ width: width(from) }, { width: width(value) }], {
      duration: BEAT_MS.drain + 250,
      delay: 300,
      easing: "ease-in-out",
      fill: "backwards",
    });
  };
  const floatWord = (id, text, tone) => {
    const el = fighter(id);
    if (!el) return;
    const word = add(el, document.createElement("span"));
    word.className = "combat-word";
    word.dataset.tone = tone;
    word.textContent = text;
    word.setAttribute("aria-hidden", "true");
    animate(
      word,
      reduced()
        ? [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1 }]
        : [
            { opacity: 0, translate: "-50% 6px" },
            { opacity: 1, translate: "-50% -8px", offset: 0.2 },
            { opacity: 1, translate: "-50% -22px", offset: 0.75 },
            { opacity: 0, translate: "-50% -32px" },
          ],
      { duration: BEAT_MS.word + 200, easing: "ease-out", fill: "forwards" },
    );
  };
  // Painted effect stills (#1920) over a fighter: a hit burst sized by the
  // recorded damage, brace shields and lunge trails. Each fades in and out;
  // with motion and "Flashes and scares" on it also scales. Reduced motion
  // shows the single still.
  const effect = (id, name, duration = BEAT_MS.recoil) => {
    const el = fighter(id);
    if (!el) return null;
    const still = add(el, document.createElement("img"));
    still.className = "combat-effect";
    still.dataset.effect = name;
    still.alt = "";
    still.src = imageUrl(`./assets/combat/effects/${name}.png`);
    const pop = !reduced() && scaresEnabled();
    animate(
      still,
      [
        { opacity: 0, scale: pop ? 0.7 : 1 },
        { opacity: 1, scale: 1, offset: 0.25 },
        { opacity: 1, offset: 0.7 },
        { opacity: 0, scale: pop ? 1.08 : 1 },
      ],
      { duration, easing: "ease-out", fill: "forwards" },
    );
    return still;
  };
  const pose = (id, value) => {
    portraits.pose(id, value === "intercept" ? "guard" : value);
  };
  // Each exchange's fighters step into the front slots, facing each other;
  // the other combatants take the slots behind and dim. The slots are the
  // scene's own, so phone framing holds.
  let slots = null;
  const STAGE_VARS = ["--stage-x", "--stage-floor", "--stage-size"];
  const slotOf = (el) => ({
    el,
    vars: STAGE_VARS.map((v) => el.style.getPropertyValue(v)),
    depth: el.dataset.depth,
  });
  const DEPTHS = ["foreground", "middle", "back"];
  const stageExchange = (beat, combatants) => {
    const els = combatants.map(fighter).filter(Boolean);
    if (els.length < 2) return;
    slots ??= els
      .map(slotOf)
      .sort(
        (a, b) =>
          DEPTHS.indexOf(a.depth) - DEPTHS.indexOf(b.depth) ||
          parseFloat(b.vars[2]) - parseFloat(a.vars[2]),
      );
    const front = beat.front.map(fighter).filter((el) => els.includes(el));
    const x = (el) => parseFloat(el.style.getPropertyValue("--stage-x"));
    const ahead = slots
      .slice(0, front.length)
      .sort((a, b) => parseFloat(a.vars[0]) - parseFloat(b.vars[0]));
    if (front.length > 1 && x(front[0]) > x(front.at(-1))) ahead.reverse();
    // A guard stands between the striker and the one it covers.
    if (front.length === 3) front.splice(1, 2, front[2], front[1]);
    const rest = els
      .filter((el) => !front.includes(el))
      .sort((a, b) => x(a) - x(b));
    [...front, ...rest].forEach((el, i) => {
      const slot = i < front.length ? ahead[i] : slots[i];
      const shift = el.style.getPropertyValue("--stage-x") !== slot.vars[0];
      STAGE_VARS.forEach((v, n) => el.style.setProperty(v, slot.vars[n]));
      el.dataset.depth = i < front.length ? "foreground" : slot.depth;
      el.dataset.battleRow = i < front.length ? "front" : "back";
      if (shift && reduced())
        animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    });
    stage.querySelector("#cast").dataset.battle = "true";
    const at = (el) => parseFloat(el.style.getPropertyValue("--stage-x"));
    const aim = fighter(beat.coveredId || beat.targetId);
    for (const el of front) {
      const other = el === fighter(beat.actorId) ? aim : fighter(beat.actorId);
      if (other)
        portraits.face(
          el.dataset.avatar,
          other.dataset.avatar,
          at(other) > at(el) ? "right" : "left",
        );
    }
  };
  // The redrawn scene keeps the last exchange in front (scene.mjs).
  const releaseExchange = () => {
    for (const el of stage.querySelectorAll("[data-battle-row]"))
      delete el.dataset.battleRow;
    slots = null;
    delete stage.querySelector("#cast")?.dataset.battle;
  };

  const pushIn = () => {
    if (cut) return;
    stage.dataset.combat = "true";
    const dim = add(stage, document.createElement("div"));
    dim.className = "combat-dim";
    const scene = [
      stage.querySelector("#backdrop:not([hidden])"),
      stage.querySelector("#stage-figures"),
      stage.querySelector("#cast"),
      stage.querySelector("#floor-items"),
    ].filter(Boolean);
    cut = { dim, scene };
    if (reduced()) {
      dim.style.opacity = "1";
      return;
    }
    for (const el of scene)
      animate(el, [{ scale: 1 }, { scale: 1.08 }], {
        duration: 260,
        easing: "ease-out",
        fill: "forwards",
      });
    animate(dim, [{ opacity: 0 }, { opacity: 1 }], {
      duration: 260,
      fill: "forwards",
    });
  };
  const releaseCut = async () => {
    if (!cut) return;
    const { dim, scene } = cut;
    cut = null;
    if (!reduced()) {
      const back = [...scene, dim].map((el) =>
        el.animate(
          el === dim
            ? [{ opacity: 1 }, { opacity: 0 }]
            : [{ scale: 1.08 }, { scale: 1 }],
          { duration: 220, easing: "ease-in-out" },
        ),
      );
      await Promise.allSettled(back.map((a) => a.finished));
    }
  };
  const strike = (beat) => {
    const attacker = fighter(beat.actorId),
      target = fighter(beat.targetId);
    pose(beat.actorId, "attack");
    target?.classList.add("combat-targeted");
    if (!attacker || !target) return;
    if (reduced()) {
      attacker.classList.add("combat-outline");
      return;
    }
    const a = attacker.getBoundingClientRect(),
      b = target.getBoundingClientRect();
    const toward = Math.sign(b.x + b.width / 2 - (a.x + a.width / 2)) || 1;
    const reach = Math.min(
      90,
      Math.abs(b.x + b.width / 2 - (a.x + a.width / 2)) * 0.35,
    );
    const total = BEAT_MS.lunge + BEAT_MS.hold + BEAT_MS.back;
    // A short reach or a fighter without strike art jabs; others swipe.
    const source = attacker.querySelector(".portrait-body > img")?.dataset
      .source;
    const armed = combatPortrait(
      beat.actorId,
      "attack",
      source,
      attacker.dataset.facing,
    );
    effect(
      beat.actorId,
      `${armed && reach >= 40 ? "swipe" : "jab"}-${toward > 0 ? "right" : "left"}`,
      total,
    );
    animate(
      bodyOf(attacker),
      [
        { translate: "0 0" },
        {
          translate: `${toward * reach}px -4px`,
          offset: BEAT_MS.lunge / total,
          easing: "cubic-bezier(.5,0,.75,0)",
        },
        {
          translate: `${toward * reach}px -4px`,
          offset: (BEAT_MS.lunge + BEAT_MS.hold) / total,
        },
        { translate: "0 0" },
      ],
      { duration: total, easing: "ease-out" },
    );
  };
  const impact = (beat) => {
    const target = fighter(beat.targetId);
    if (!target) return;
    pose(beat.targetId, beat.outcome === "guarded" ? "guard" : "hit");
    effect(beat.targetId, `hit-${Math.min(3, Math.max(1, beat.damage || 1))}`);
    if (beat.outcome === "guarded") effect(beat.targetId, "brace-absorb");
    const body = bodyOf(target);
    if (reduced()) {
      target.classList.add("combat-outline");
      return;
    }
    const attacker = fighter(beat.actorId)?.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const away = attacker ? Math.sign(t.x - attacker.x) || 1 : 1;
    // Hit-stop: the target holds still for a moment, then recoils and
    // shakes with a decaying amplitude. One brightness flash, never red.
    animate(
      body,
      [
        { translate: "0 0" },
        { translate: "0 0", offset: 0.2 },
        { translate: `${away * 12}px 0`, offset: 0.4 },
        { translate: `${away * -6}px 0`, offset: 0.58 },
        { translate: `${away * 3}px 0`, offset: 0.76 },
        { translate: "0 0" },
      ],
      { duration: BEAT_MS.hitStop + 380, easing: "ease-out" },
    );
    // Flashes follow the "Flashes and scares" setting.
    if (scaresEnabled())
      animate(
        body,
        [
          { filter: "brightness(1)" },
          { filter: "brightness(1.9)", offset: 0.3 },
          { filter: "brightness(1)" },
        ],
        { duration: 180, delay: BEAT_MS.hitStop },
      );
  };
  const finishAnimations = () => {
    for (const animation of animations) {
      try {
        animation.finish();
      } catch {}
    }
  };
  const apply = (beat, phase) => {
    if (phase === "telegraph") {
      pushIn();
      const actor = fighter(beat.actorId);
      add(actor, svgIcon(beat.kind));
      stageExchange(beat, Object.keys(beat.resolve || {}));
      if (beat.kind === "attack")
        fighter(beat.coveredId || beat.targetId)?.classList.add(
          "combat-reticle",
        );
      pose(beat.actorId, beat.kind === "attack" ? "threaten" : beat.kind);
      setCaption(`${telegraphText(beat)}…`);
      return;
    }
    if (phase === "strike") {
      strike(beat);
      return;
    }
    if (phase === "impact") {
      impact(beat);
      // Text before effect: the rules line lands as the hit lands.
      setCaption(beat.text);
      revealLine(beat.seq);
      showResolve(beat.targetId, beat.resolveAfter, beat.resolveBefore);
      floatWord(beat.targetId, outcomeWord(beat), beat.outcome);
      return;
    }
    if (phase === "resolve") {
      for (const el of stage.querySelectorAll(".combat-telegraph")) el.remove();
      if (beat.kind === "attack") {
        fighter(beat.coveredId || beat.targetId)?.classList.remove(
          "combat-reticle",
        );
        return;
      }
      setCaption(beat.text);
      revealLine(beat.seq);
      pose(beat.actorId, beat.kind);
      if (beat.kind === "guard")
        effect(beat.actorId, "brace-raise", BEAT_MS.word);
      for (const id of Object.keys(beat.resolve || {}))
        showResolve(id, beat.resolve[id]);
      floatWord(beat.actorId, outcomeWord(beat), beat.kind);
      return;
    }
    if (phase === "beaten") {
      pose(beat.loserId, "beaten");
      fighter(beat.loserId)?.classList.add("combat-beaten");
      revealLine(beat.seq);
      floatWord(beat.loserId, beat.sentHome ? "Sent home" : "Beaten", "beaten");
      const summary = defeatSummary(beat);
      setCaption(
        beat.viewerLost
          ? `${summary.title}.`
          : `${nameOf(beat.loserId)} yields to ${inSentence(beat.winnerId)}.`,
      );
    }
  };
  const runner = createBeatRunner({
    apply,
    delay: (ms, done) => {
      const timer = setTimeout(done, ms);
      return { cancel: () => clearTimeout(timer) };
    },
  });
  const finishBeat = () => {
    finishAnimations();
    runner.finishBeat();
  };
  let defeatDone = null;
  const continueButton = dialog.querySelector("[data-combat-continue]");
  const closeDefeat = () => {
    if (dialog.open) dialog.close();
    const done = defeatDone;
    defeatDone = null;
    done?.();
  };
  continueButton.onclick = closeDefeat;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDefeat();
  });
  return {
    get active() {
      return Boolean(cut) || added.length > 0;
    },
    async play(beats) {
      const mine = ++portraitRun;
      for (const { actorId, targetId, coveredId } of beats) {
        portraits.face(actorId, coveredId || targetId);
        portraits.face(targetId, actorId);
      }
      await portraits.prepare(beats);
      if (mine !== portraitRun) return false;
      speed = combatSpeed();
      stage.style.setProperty("--combat-speed", String(speed));
      stage.addEventListener("pointerdown", finishBeat);
      try {
        return await runner.run(beats, { speed });
      } finally {
        stage.removeEventListener("pointerdown", finishBeat);
      }
    },
    finishBeat,
    // Wait for the player on a defeat card. Resolves on Continue.
    defeat(beat) {
      const summary = defeatSummary(beat);
      dialog.querySelector("[data-combat-title]").textContent = summary.title;
      const list = dialog.querySelector("[data-combat-changes]");
      list.replaceChildren(
        ...summary.changes.map((text) => {
          const item = document.createElement("li");
          item.textContent = text;
          return item;
        }),
      );
      announce.textContent = `${summary.title}. ${summary.changes.join(" ")}`;
      return new Promise((resolve) => {
        defeatDone = resolve;
        dialog.showModal();
        continueButton.focus();
      });
    },
    async release() {
      setCaption("");
      await releaseCut();
    },
    cleanup() {
      portraitRun++;
      runner.cancel();
      portraits.restore();
      closeDefeat();
      for (const animation of animations) animation.cancel();
      animations = [];
      for (const el of added) el.remove();
      added = [];
      releaseExchange();
      cut = null;
      delete stage.dataset.combat;
      for (const el of stage.querySelectorAll(
        ".combat-reticle, .combat-outline, .combat-targeted, .combat-beaten",
      ))
        el.classList.remove(
          "combat-reticle",
          "combat-outline",
          "combat-targeted",
          "combat-beaten",
        );
      setCaption("");
    },
  };
}
