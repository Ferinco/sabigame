export const CATEGORIES = ["football", "general_knowledge", "afrobeats"] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
