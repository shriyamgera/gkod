import cableClip from './cable_clip.scad?raw';
import phoneStand from './phone_stand.scad?raw';
import wallHook from './wall_hook.scad?raw';

export const examples: { id: string; name: string; source: string }[] = [
  { id: 'phone_stand', name: 'Phone stand', source: phoneStand },
  { id: 'wall_hook', name: 'Wall hook', source: wallHook },
  { id: 'cable_clip', name: 'Cable clip', source: cableClip },
];

export function findExample(id: string) {
  return examples.find((example) => example.id === id);
}

// Counts the sizes a part exposes: top-level numbers with a customizer range, e.g. "width = 80; // [40:1:160]".
export function countSizes(source: string): number {
  return source.split('\n').filter((line) => /^[a-z_]\w*\s*=\s*-?[\d.]+\s*;\s*\/\/\s*\[[^\]]+\]/i.test(line)).length;
}
