// The part families: each one is a preset over the shared bodies and features, with its own size ranges.
import type { Rng } from '../rng.ts';
import type { Tree } from '../tree.ts';
import { sampleBracket } from './bracket.ts';
import { sampleChannel } from './channel.ts';
import { sampleClip } from './clip.ts';
import { sampleHook } from './hook.ts';
import { sampleKnob } from './knob.ts';
import { samplePlate } from './plate.ts';
import { sampleSpacer } from './spacer.ts';
import { sampleTray } from './tray.ts';

export type Family = { id: string; sample: (rng: Rng) => Tree };

/** In a fixed order: the order decides which family a seed picks, so new families go at the end. */
export const FAMILIES: readonly Family[] = [
  { id: 'plate', sample: samplePlate },
  { id: 'bracket', sample: sampleBracket },
  { id: 'channel', sample: sampleChannel },
  { id: 'tray', sample: sampleTray },
  { id: 'spacer', sample: sampleSpacer },
  { id: 'hook', sample: sampleHook },
  { id: 'knob', sample: sampleKnob },
  { id: 'clip', sample: sampleClip },
];

export function findFamily(id: string): Family | undefined {
  return FAMILIES.find((family) => family.id === id);
}

/** The tree of part `index` for a run seed: its own generator, so it never depends on the other parts. */
export function sampleTree(partRng: Rng): Tree {
  const family = partRng.child(0).pick(FAMILIES);
  return family.sample(partRng.child(1));
}
