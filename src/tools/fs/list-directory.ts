import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

export const listDirectoryTool = tool({
  name: 'list_directory',
  description: 'List directory contents in a tree-like format. Shows files and folders with indicators.',
  inputSchema: z.object({
    path: z.string().optional(),
    recursive: z.boolean().default(false),
    depth: z.number().default(2),
  }),
  execute: async (params: Record<string, unknown>) => {
    const { readdir, readFile } = await import('fs/promises');
    const { join, relative } = await import('path');
    const cwd = (params.path as string) ?? process.cwd();
    const recursive = (params.recursive as boolean) ?? false;
    const maxDepth = (params.depth as number) ?? 2;
    const entries: string[] = [];

    async function getIgnorePatterns(cwd: string): Promise<string[]> {
      const gitignorePath = join(cwd, '.gitignore');
      try {
        const stats = await readFile(gitignorePath);
        if (stats.length > 1024 * 100) return [];
        return stats.toString('utf-8').split('\n').filter((line: string) => line.trim() && !line.startsWith('#'));
      } catch {
        return [];
      }
    }

    const ignorePatterns = await getIgnorePatterns(cwd);

    async function walk(dir: string, currentDepth: number): Promise<void> {
      if (currentDepth > maxDepth) return;
      try {
        const items = await readdir(dir, { withFileTypes: true });
        const sorted = items.sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
        for (const item of sorted) {
          const relPath = relative(cwd, join(dir, item.name));
          const isDir = item.isDirectory();
          const indent = '  '.repeat(currentDepth);
          entries.push(`${indent}${isDir ? '[' : ''}${item.name}${isDir ? ']' : ''}`);
          if (isDir && recursive && currentDepth < maxDepth) {
            await walk(join(dir, item.name), currentDepth + 1);
          }
        }
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (e.code === 'EACCES') entries.push(`  [Permission denied]`);
      }
    }

    await walk(cwd, 0);
    return { entries, path: cwd };
  },
});