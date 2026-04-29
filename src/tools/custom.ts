import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

export const customTool = tool({
  name: 'custom',
  description: 'A template for domain-specific tools. Replace this with your own implementation.',
  inputSchema: z.object({
    action: z.string().describe('Action to perform'),
    payload: z.string().optional().describe('Optional payload'),
  }),
  execute: async ({ action, payload }) => {
    return {
      result: `Custom tool executed: ${action}`,
      payload: payload ?? null,
      note: 'Replace this tool with domain-specific logic.',
    };
  },
});
