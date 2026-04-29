import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

export const requestInputTool = tool({
  name: 'request_input',
  description: 'Ask the user a multiple-choice question. The CLI will prompt and return the answer.',
  inputSchema: z.object({
    question: z.string().describe('Question text'),
    options: z.array(z.string()).describe('Available choices'),
    allowMultiple: z.boolean().optional().describe('Allow selecting multiple options'),
  }),
  execute: async ({ question, options, allowMultiple }) => {
    // This is a read-only tool that blocks; the CLI handles the actual prompting
    return {
      question,
      options,
      allowMultiple: allowMultiple ?? false,
      note: 'The CLI will intercept this tool call and prompt the user directly.',
    };
  },
});
