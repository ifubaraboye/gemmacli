import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

export const fileWriteTool = tool({
  name: 'file_write',
  description: 'Write content to a file. Creates parent directories if needed. Overwrites existing files.',
  inputSchema: z.object({
    path: z.string().describe('Absolute path to the file'),
    content: z.string().describe('Content to write'),
  }),
  execute: async ({ path, content }) => {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf-8');
      return { success: true, path };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});
