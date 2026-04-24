import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

export const fileReadTool = tool({
  name: 'read_file',
  description: 'Read the contents of a file at the given path. Shows line numbers for easy reference.',
  inputSchema: z.object({
    path: z.string(),
    offset: z.number().optional(),
    limit: z.number().optional(),
  }),
  execute: async (params: Record<string, unknown>) => {
    const { readFile, stat } = await import('fs/promises');
    const { path, offset, limit } = params as { path: string; offset?: number; limit?: number };
    try {
      const stats = await stat(path);
      if (stats.size > 1024 * 1024) {
        return { error: `File too large: ${path} (${stats.size} bytes)` };
      }
      const ext = path.toLowerCase().split('.').pop() ?? '';
      if (IMAGE_EXTENSIONS.includes(`.${ext}`)) {
        return { error: 'Binary file - use view_image tool instead' };
      }
      const content = await readFile(path, 'utf-8');
      const lines = content.split('\n');
      const start = offset ? offset - 1 : 0;
      const end = limit ? start + limit : lines.length;
      const slice = lines.slice(start, end);
      const numbered = slice.map((line: string, i: number) => `${start + i + 1}: ${line}`).join('\n');
      return {
        content: numbered,
        totalLines: lines.length,
        ...(end < lines.length && { truncated: true, nextOffset: end + 1 }),
      };
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'ENOENT') return { error: `File not found: ${path}` };
      if (e.code === 'EACCES') return { error: `Permission denied: ${path}` };
      return { error: e.message ?? String(err) };
    }
  },
});