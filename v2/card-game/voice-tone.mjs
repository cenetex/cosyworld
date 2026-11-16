export const TONE = {
  highpass: 110,
  lowpass: 3000,
  threshold: -28,
  ratio: 6,
  attack: 0.005,
  release: 0.25,
  makeup: 10 ** (4 / 20),
  echoDelay: 0.028,
  echoLevel: 0.18,
  level: 0.9 * 10 ** (-5 / 20),
};

const chains = new WeakMap();

function build(context) {
  const filter = (type, frequency) => {
    const node = context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    return node;
  };
  const gain = (value) => {
    const node = context.createGain();
    node.gain.value = value;
    return node;
  };
  const input = filter("highpass", TONE.highpass);
  const soft = filter("lowpass", TONE.lowpass);
  const even = context.createDynamicsCompressor();
  even.threshold.value = TONE.threshold;
  even.ratio.value = TONE.ratio;
  even.attack.value = TONE.attack;
  even.release.value = TONE.release;
  const lifted = gain(TONE.makeup);
  const room = context.createDelay(0.1);
  room.delayTime.value = TONE.echoDelay;
  const wet = gain(TONE.echoLevel);
  const out = gain(TONE.level);
  input.connect(soft);
  soft.connect(even);
  even.connect(lifted);
  lifted.connect(out);
  lifted.connect(room);
  room.connect(wet);
  wet.connect(out);
  out.connect(context.destination);
  return input;
}

export function voiceTone(context) {
  if (
    typeof context?.createBiquadFilter !== "function" ||
    typeof context.createDynamicsCompressor !== "function" ||
    typeof context.createDelay !== "function" ||
    typeof context.createGain !== "function"
  )
    return context.destination;
  if (!chains.has(context)) chains.set(context, build(context));
  return chains.get(context);
}
