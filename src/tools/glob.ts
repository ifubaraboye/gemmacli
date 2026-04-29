import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { glob } from 'glob';

export const globTool = tool({
  name: 'glob',
  description: 'Find files matching a glob pattern. Respects .gitignore by default.',
  inputSchema: z.object({
    pattern: z.string().describe('Glob pattern to match (e.g., "src/**/*.ts")'),
    cwd: z.string().optional().describe('Working directory for the search'),
    dot: z.boolean().optional().describe('Include dotfiles'),
  }),
  execute: async ({ pattern, cwd, dot }) => {
    try {
      const matches = await glob(pattern, { cwd: cwd ?? process.cwd(), dot: dot ?? false, nodir: true });
      return { matches, count: matches.length };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});
