import fs from 'fs';
import path from 'path';

const promptCache = new Map<string, string>();

/**
 * Load a markdown prompt file and optionally interpolate template variables.
 * @param relativePath Path relative to `src/prompts` (e.g. 'system/cooper.system.md')
 * @param variables Optional key-value dictionary for {{variable}} replacements
 */
export function loadPrompt(
  relativePath: string,
  variables?: Record<string, string | number>
): string {
  const isDev = process.env.NODE_ENV !== 'production';

  // In production, serve from memory cache
  let content = promptCache.get(relativePath);
  if (!content || isDev) {
    const fullPath = path.join(process.cwd(), 'src', 'prompts', relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Prompt file not found at: ${fullPath}`);
    }
    content = fs.readFileSync(fullPath, 'utf-8');
    promptCache.set(relativePath, content);
  }

  // Variable interpolation: replaces {{key}} with values
  if (variables) {
    return Object.entries(variables).reduce((acc, [key, val]) => {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
      return acc.replace(regex, String(val));
    }, content);
  }

  return content;
}