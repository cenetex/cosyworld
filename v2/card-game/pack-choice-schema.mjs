const ACTIVE_CHOICE_LIMIT = 256;
const ARCHIVED_CHOICE_LIMIT = 64;
export const PACK_CHOICE_LIMIT = ACTIVE_CHOICE_LIMIT + ARCHIVED_CHOICE_LIMIT;

export function choiceCountProblem(choices = []) {
  const archived = choices.filter((choice) => choice.archived === true).length;
  return choices.length - archived <= ACTIVE_CHOICE_LIMIT && archived <= ARCHIVED_CHOICE_LIMIT
    ? null
    : `choices must have at most ${ACTIVE_CHOICE_LIMIT} active and ${ARCHIVED_CHOICE_LIMIT} archived entries`;
}

export function validChoiceReceipt(condition, choices, keysOk, idOk, intOk) {
  return keysOk(condition, ["kind", "choiceId", "within"]) && idOk(condition.choiceId) &&
    (condition.within === undefined || intOk(condition.within, 1, 48)) &&
    choices.some((choice) => choice.id === condition.choiceId && choice.effects.length > 0 && !choice.archived);
}

export function choicePresentationProblems(pack, choice, items, choices, keysOk, textOk) {
  const problems = [];
  const prefix = `${pack.id}: choice ${choice.id}`;
  if (choice.fullHandsText !== undefined &&
    !(choice.on === "talk" && choice.humanOnly && Array.isArray(choice.effects) &&
      choice.effects.some((effect) => effect?.kind === "give_item") &&
      textOk(choice.fullHandsText, 120)))
    problems.push(`${prefix} fullHandsText needs a human Talk that hands over an item`);

  if (choice.recap === undefined) return problems;
  const { record, answers } = choice.recap ?? {};
  const book = Object.hasOwn(items, record) ? items[record] : null;
  const outcomes = Array.isArray(answers) && answers.length === 2
    ? answers.map((id) => choices.find((answer) => answer?.id === id && answer.at === choice.at)
        ?.effects?.find((effect) => effect?.kind === "choose"))
    : [];
  if (!(keysOk(choice.recap, ["record", "answers"]) &&
    choice.on === "talk" && choice.effects?.length > 0 &&
    !choice.repeats && !choice.archived &&
    !(pack.topics || []).some((topic) => topic.choiceId === choice.id) &&
    book?.lifecycle === "fixed" && book.holder === choice.at &&
    Array.isArray(book.records) && outcomes[0] && outcomes[1] &&
    answers.every((id) => book.records.includes(id)) && outcomes[0].key === outcomes[1].key &&
    outcomes[0].value !== outcomes[1].value))
    problems.push(`${prefix} recap needs two local outcomes in a fixed record`);
  return problems;
}
