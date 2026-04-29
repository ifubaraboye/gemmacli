import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';

export const fileEditTool = tool({
  name: 'file_edit',
  description: 'Edit a file by replacing all occurrences of oldString with newString. Returns a unified diff of changes.',
  inputSchema: z.object({
    path: z.string().describe('Absolute path to the file'),
    oldString: z.string().describe('Exact text to replace'),
    newString: z.string().describe('Replacement text'),
  }),
  execute: async ({ path, oldString, newString }) => {
    try {
      const content = await readFile(path, 'utf-8');
      if (!content.includes(oldString)) {
        return { error: `oldString not found in ${path}` };
      }
      const newContent = content.replaceAll(oldString, newString);
      await writeFile(path, newContent, 'utf-8');
      return { success: true, path, replacements: content.split(oldString).length - 1 };
    } catch (err: any) {
      if (err.code === 'ENOENT') return { error: `File not found: ${path}` };
      if (err.code === 'EACCES') return { error: `Permission denied: ${path}` };
      return { error: err.message };
    }
  },
});
