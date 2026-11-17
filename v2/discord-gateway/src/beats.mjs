const SENTENCE = /[^.!?…]+(?:[.!?…]+["'”’)]*|$)/gu;

function length(text) {
  return Array.from(text).length;
}

export function sentences(text) {
  return (String(text ?? "").match(SENTENCE) ?? []).map((part) => part.trim()).filter(Boolean);
}

export function beats(text, { min = 140, most = 3 } = {}) {
  const clean = String(text ?? "").trim();
  const parts = sentences(clean);
  if (length(clean) < min || parts.length < 2) return [clean];
  const count = Math.min(most, parts.length);
  const target = length(clean) / count;
  const out = [];
  let current = "";
  for (const part of parts) {
    if (current && out.length < count - 1 && length(current) >= target * 0.8) {
      out.push(current);
      current = part;
    } else {
      current = current ? `${current} ${part}` : part;
    }
  }
  out.push(current);
  return out;
}

export function pause(text, { least = 1000, most = 4000, per = 35 } = {}) {
  return Math.min(most, Math.max(least, length(String(text ?? "")) * per));
}

function opening(text) {
  const words = String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.length >= 3 ? words.slice(0, 4).join(" ") : null;
}

export function repeatsOpening(messages, residentId, text) {
  const head = opening(text);
  if (!head) return false;
  return messages
    .filter((entry) => entry.resident === residentId)
    .slice(-5)
    .some((entry) => opening(entry.text) === head);
}

function tokens(text) {
  return (
    String(text ?? "")
      .toLowerCase()
      .replace(/['’\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, "")
      .match(/\p{Extended_Pictographic}|[\p{L}\p{N}]+/gu) ?? []
  );
}

export function repeatsLine(lines, text, most = 0.8) {
  const mine = new Set(tokens(text));
  if (!mine.size) return false;
  return lines.some((line) => {
    const theirs = new Set(tokens(line));
    const shared = [...mine].filter((token) => theirs.has(token)).length;
    return shared / (mine.size + theirs.size - shared) >= most;
  });
}

export function wait(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
