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
