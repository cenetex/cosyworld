// A step is a target hand: all three parts must be true at the same time.
// Programs compose these steps in order. Completing a program earns one level.
export const questPrograms = {
  vale: [
    {
      id: "borrowed-light",
      name: "Borrowed light",
      steps: [
        { items: ["lamp"], location: "station", avatars: ["moth"] },
        { items: ["oil"], location: "attic", avatars: ["keeper"] },
        { items: ["cloth"], location: "pond", avatars: ["moth"] },
      ],
    },
    {
      id: "the-bell-below",
      name: "The bell below",
      steps: [
        { items: ["bell"], location: "pond", avatars: ["keeper"] },
        { items: ["lamp", "bell"], location: "station", avatars: ["moth"] },
      ],
    },
  ],
  moth: [
    {
      id: "a-light-and-a-witness",
      name: "A light and a witness",
      steps: [
        { items: ["lamp"], location: "pond", avatars: ["vale"] },
        { items: ["oil"], location: "attic", avatars: ["keeper"] },
      ],
    },
    {
      id: "a-veil-for-the-eye",
      name: "A veil for the eye",
      steps: [
        { items: ["cloth"], location: "pond", avatars: ["vale"] },
        { items: ["lamp"], location: "station", avatars: ["keeper"] },
      ],
    },
  ],
  keeper: [
    {
      id: "the-quiet-hour",
      name: "The quiet hour",
      steps: [
        { items: ["bell"], location: "attic", avatars: ["vale"] },
        { items: ["cloth"], location: "attic", avatars: ["moth"] },
      ],
    },
    {
      id: "the-hour-below",
      name: "The hour below",
      steps: [
        { items: ["bell"], location: "pond", avatars: ["vale"] },
        { items: ["oil"], location: "station", avatars: ["moth"] },
      ],
    },
  ],
};
export const restingHands = {
  vale: { items: [], location: null, avatars: [] },
  moth: { items: [], location: "pond", avatars: [] },
  keeper: { items: [], location: "attic", avatars: [] },
};
export const newProgress = () => ({ program: 0, step: 0, marks: [] });
export const programFor = (s, actor) =>
  questPrograms[actor][s.actors[actor].progress.program] || null;
export const desireFor = (s, actor) =>
  programFor(s, actor)?.steps[s.actors[actor].progress.step] ||
  restingHands[actor];
export const levelOf = (s, actor) => 1 + s.actors[actor].progress.program;
