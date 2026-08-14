const BOT_NAMES = [
  "Pablo",
  "Valking",
  "Alabi",
  "Tara",
  "Chichi",
  "Peteru",
  "Eben",
  "Ifeko",
  "Amara",
  "Pedro",
  "Chima",
  "Angel",
  "Hezzz",
  "Sabigirl",
  "Donbabaj",
  "Kizi",
  "Dandan",
  "Pelumi",
  "Fireboy",
  "Wizzy",
  "Burna",
  "Oladi",
];

export function getBotName(playerId: string): string {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  return BOT_NAMES[hash % BOT_NAMES.length];
}
