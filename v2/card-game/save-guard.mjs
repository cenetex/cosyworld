export function sealSave(world, { encode, read }) {
  const text = encode(world);
  read(text);
  return text;
}

export function writeSave(storage, key, world, codec) {
  const text = sealSave(world, codec);
  storage.setItem(key, text);
  return text;
}
