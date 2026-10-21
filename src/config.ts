import { homedir } from 'node:os';
import { join } from 'node:path';

export const roots = {
  quests: 'https://terrafirmagreg-team.github.io/QuestBook-Modern/',
  recipes: 'https://terrafirmagreg-team.github.io/RecipeBook-Modern/',
  guide: 'https://terrafirmagreg-team.github.io/Field-Guide-Modern/',
} as const;
export type Source = keyof typeof roots;
export const questData = `${roots.quests}data/quest-export/`;
export const cacheDirectory = process.env.TFGM_CACHE_DIR || join(homedir(), '.cache', 'tfgm-mcp');
export function resourcePath(id: string): { namespace: string; path: string } {
  const match = /^([a-z0-9_.-]+):([a-zA-Z0-9_./-]+)$/.exec(id);
  if (!match || match[1] === '.' || match[1] === '..' || match[2]!.includes('//') || match[2]!.split('/').some(p => p === '.' || p === '..')) {
    throw new Error(`Invalid resource ID: ${id}`);
  }
  return { namespace: match[1]!, path: match[2]! };
}
export function locale(value: string): string {
  if (!/^[a-z]{2}_[a-z]{2}$/.test(value)) throw new Error('Language must use the format zh_cn or en_us');
  return value;
}
