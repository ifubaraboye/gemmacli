import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';

export const listDirTool = tool({
  name: 'list_dir',
  description: 'List the contents of a directory. Appends / to directories.',
  inputSchema: z.object({
    path: z.string().describe('Absolute path to the directory'),
  }),
  execute: async ({ path }) => {
    try {
      const entries = await readdir(path);
      const items = await Promise.all(
        entries.map(async (name: string) => {
          const isDir = await stat(join(path, name)).then((s: import('fs').Stats) => s.isDirectory()).catch(() => false);
          return isDir ? `${name}/` : name;
        }),
      );
      return { items, count: items.length };
    } catch (err: any) {
      if (err.code === 'ENOENT') return { error: `Directory not found: ${path}` };
      if (err.code === 'EACCES') return { error: `Permission denied: ${path}` };
      return { error: err.message };
    }
  },
});
