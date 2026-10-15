import type { MiniMiActivity } from "@/lib/theme/useMiniMi";
import { MINI_MI_REACTION_CHOICES } from "@/lib/theme/preferences";

/** A complete playful rotation before repeating; excludes poses suggesting real work. */
export const MINI_MI_REACTIONS = MINI_MI_REACTION_CHOICES;
export function nextMiniMiReaction(previous: MiniMiActivity | null, favorites: readonly MiniMiActivity[] = MINI_MI_REACTIONS): MiniMiActivity {
  const choices = MINI_MI_REACTIONS.filter(item => favorites.includes(item));
  if (!choices.length) return "idle";
  const index = choices.findIndex(value => value === previous);
  return choices[(index + 1) % choices.length];
}
