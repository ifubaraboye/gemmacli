import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

export const fileWriteTool = tool({
  name: 'write_file',
  description: 'Write content to a file using str_replace semantics. Either write a new file or replace specific text.',
  inputSchema: z.object({
    path: z.string(),
    content: z.string(),
    old_str: z.string().optional(),
    new_str: z.string().optional(),
  }),
  execute: async (params: Record<string, unknown>) => {
    const { readFile, writeFile, mkdir } = await import('fs/promises');
    const { dirname } = await import('path');
    const { path, content, old_str, new_str } = params as {
      path: string;
      content: string;
      old_str?: string;
      new_str?: string;
    };
    try {
      if (old_str && new_str) {
        const existing = await readFile(path, 'utf-8');
        if (!existing.includes(old_str)) {
          return { error: `old_str not found in file. Cannot apply patch to ${path}` };
        }
        const updated = existing.replace(old_str, new_str);
        await writeFile(path, updated, 'utf-8');
        return { written: true, path, mode: 'str_replace' };
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf-8');
      return { written: true, path, mode: 'overwrite' };
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'EACCES') return { error: `Permission denied: ${path}` };
      return { error: e.message ?? String(err) };
    }
  },
});