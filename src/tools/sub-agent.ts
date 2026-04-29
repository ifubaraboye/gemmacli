import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

export const subAgentTool = tool({
  name: 'sub_agent',
  description: 'Spawn a child agent with a focused task and tool set. Returns the child result.',
  inputSchema: z.object({
    task: z.string().describe('Task description for the child agent'),
    tools: z.array(z.string()).optional().describe('Tool names to allow (default: all)'),
    maxSteps: z.number().optional().describe('Max steps for the child'),
  }),
  execute: async ({ task, tools: toolNames, maxSteps }) => {
    // Simplified: in a full implementation this would instantiate a new OpenRouter agent
    return {
      result: `Sub-agent would execute: ${task}`,
      note: 'Full sub-agent spawning requires additional orchestration.',
    };
  },
});
