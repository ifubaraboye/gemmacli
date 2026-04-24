import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

export const grepFilesTool = tool({
  name: 'grep_files',
  description: 'Search file contents by regex pattern. Returns matches with line numbers.',
  inputSchema: z.object({
    regex: z.string(),
    path: z.string().optional(),
    glob: z.string().optional(),
    ignoreCase: z.boolean().default(false),
  }),
  execute: async (params: Record<string, unknown>) => {
    const { readdir, readFile } = await import('fs/promises');
    const { join } = await import('path');
    const cwd = (params.path as string) ?? process.cwd();
    const regex = params.regex as string;
    const glob = params.glob as string | undefined;
    const ignoreCase = (params.ignoreCase as boolean) ?? false;
    const matches: { file: string; line: number; content: string }[] = [];

    try {
      const flags = ignoreCase ? 'i' : '';
      const pattern = new RegExp(regex, flags);

      async function searchInDir(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            await searchInDir(fullPath);
          } else if (entry.isFile()) {
            if (glob) {
              const mask = new RegExp(glob.replace(/\*/g, '.*'));
              if (!mask.test(entry.name)) continue;
            }
            try {
              const content = await readFile(fullPath, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (pattern.test(lines[i])) {
                  matches.push({ file: fullPath, line: i + 1, content: lines[i].trim() });
                  if (matches.length >= 100) return;
                }
              }
            } catch { /* skip */ }
          }
        }
      }

      await searchInDir(cwd);
      return { matches, total: matches.length };
    } catch (err: unknown) {
      return { matches: [], total: 0, error: String(err) };
    }
  },
});