import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const findSkillsTool = tool({
  name: 'find_skills',
  description: 'Search the open agent skills ecosystem for relevant skills. Use when the user asks about finding a skill, wants to extend capabilities, or asks "is there a skill for X?". Skills are modular packages that provide specialized knowledge and workflows.',
  inputSchema: z.object({
    query: z.string().describe('Search query to find relevant skills (e.g., "react performance", "pr review", "docker deploy")'),
  }),
  execute: async ({ query }) => {
    try {
      const { stdout, stderr } = await execAsync(`npx skills find ${query}`, {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      const out = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
      return { output: out };
    } catch (err: any) {
      const out = err.stdout ?? '';
      const errOut = err.stderr ?? '';
      const combined = out + (errOut ? `\n[stderr]\n${errOut}` : '');
      return { output: combined || err.message };
    }
  },
});
