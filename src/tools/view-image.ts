import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { readFile } from 'fs/promises';

export const viewImageTool = tool({
  name: 'view_image',
  description: 'Read a local image file and return it as a base64 data URL.',
  inputSchema: z.object({
    path: z.string().describe('Absolute path to the image file'),
  }),
  execute: async ({ path }) => {
    try {
      const data = await readFile(path);
      const ext = path.split('.').pop()?.toLowerCase() ?? 'png';
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext] ?? 'image/png';
      const base64 = data.toString('base64');
      return { dataUrl: `data:${mime};base64,${base64}` };
    } catch (err: any) {
      if (err.code === 'ENOENT') return { error: `Image not found: ${path}` };
      return { error: err.message };
    }
  },
});
