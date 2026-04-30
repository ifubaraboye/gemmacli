import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { writeFile, mkdir, readFile, access } from 'fs/promises';
import { dirname } from 'path';
import { buildFileDiff } from '../utils/diff.js';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

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
      const exists = await fileExists(path);
      let diff: string | undefined;
      if (exists) {
        const oldContent = await readFile(path, 'utf-8');
        if (oldContent !== content) {
          diff = buildFileDiff(path, oldContent, content);
        }
      }
      await writeFile(path, content, 'utf-8');
      return { success: true, path, isNew: !exists, diff };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});
