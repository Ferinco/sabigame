export const BOT_MIN_DELAY_MS = 800;
export const BOT_MAX_DELAY_MS = 4000;
export const BOT_CORRECT_CHANCE = 0.55;

export function pickBotDelayMs(rand: () => number = Math.random): number {
  return BOT_MIN_DELAY_MS + rand() * (BOT_MAX_DELAY_MS - BOT_MIN_DELAY_MS);
}

export function pickBotAnswerIndex(
  correctIndex: number,
  optionCount: number,
  rand: () => number = Math.random,
  correctChance: number = BOT_CORRECT_CHANCE
): number {
  if (rand() < correctChance) return correctIndex;

  const wrongIndices = Array.from({ length: optionCount }, (_, i) => i).filter(
    (i) => i !== correctIndex
  );

  return wrongIndices[Math.floor(rand() * wrongIndices.length)];
}
