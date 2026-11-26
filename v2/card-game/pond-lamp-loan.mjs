import { humanAvatar, humanPresent } from "./human-cast.mjs";
import { knowsFact } from "./knowledge.mjs";
import { resentment } from "./motives.mjs";

export const owedPondLamp = (world) =>
  world.pondLampLoan?.returnedTurn === undefined
    ? world.pondLampLoan
    : undefined;

export function canBorrowPondLamp(world, actor, item, owner) {
  return (
    item === "lamp" &&
    owner === "moth" &&
    world.items.lamp.holder === owner &&
    world.actors[actor].place === "pond" &&
    world.actors.moth.place === "pond" &&
    humanPresent(world, actor) &&
    knowsFact(world, actor, "quest:keeper:pond") &&
    !resentment(world, owner, actor) &&
    !world.crossings["pond-greek-harbor"]?.discovered &&
    !owedPondLamp(world)
  );
}

export const returnsPondLamp = (world, { actor, item, target }) =>
  item === "lamp" &&
  target === "moth" &&
  owedPondLamp(world)?.borrower === actor;

export function pipWaitsForLamp(world) {
  const borrower = owedPondLamp(world)?.borrower;
  return (
    borrower &&
    humanPresent(world, borrower) &&
    world.actors[borrower]?.place === "pond"
  );
}

export function validPondLampLoan(world) {
  const loan = world.pondLampLoan;
  if (loan === undefined) return true;
  const validTurn = (turn, first = 0) =>
    Number.isSafeInteger(turn) && turn >= first && turn <= world.turn;
  return Boolean(
    loan &&
      humanAvatar(loan.borrower) &&
      validTurn(loan.borrowedTurn) &&
      (!Object.hasOwn(loan, "returnedTurn") ||
        validTurn(loan.returnedTurn, loan.borrowedTurn)) &&
      Object.keys(loan).every((key) =>
        ["borrower", "borrowedTurn", "returnedTurn"].includes(key),
      ),
  );
}
