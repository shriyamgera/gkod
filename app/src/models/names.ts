import type { ModelChoice } from '../engine';

const MAX_LABEL = 48;

// The label of a version, from the typed change: one line, cut at a word near 48 characters.
export function versionLabel(instruction: string): string {
  const line = instruction.trim().split('\n')[0]!.replace(/\s+/g, ' ').trim();
  if (!line) return 'Change';
  let label = line;
  if (label.length > MAX_LABEL) {
    const cut = label.slice(0, MAX_LABEL + 1);
    const space = cut.lastIndexOf(' ');
    label = `${(space > 16 ? cut.slice(0, space) : label.slice(0, MAX_LABEL)).replace(/[,.;:\s]+$/, '')}…`;
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// phone_stand_v3.stl
export function downloadName(title: string, v: number): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 40)
    .replace(/^_+|_+$/g, '');
  return `${slug || 'part'}_v${v}.stl`;
}

// The menu name of the model that wrote a version, or its id if it is not on the menu. Claude Code reports the
// full model name, so its versions say "Claude Code (claude-...)".
export function modelName(id: string | undefined, models: ModelChoice[]): string {
  if (!id) return '';
  const label = models.find((model) => model.id === id)?.label;
  if (label) return label;
  return id.startsWith('claude-') ? `Claude Code (${id})` : id;
}
