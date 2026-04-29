import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

const plans = new Map<string, { steps: string[]; completed: number }>();

export const planTool = tool({
  name: 'plan',
  description: 'Track a multi-step task plan. Create, update, or mark steps complete.',
  inputSchema: z.object({
    id: z.string().describe('Plan identifier'),
    action: z.enum(['create', 'complete', 'status']).describe('Action to perform'),
    steps: z.array(z.string()).optional().describe('Steps for create action'),
  }),
  execute: async ({ id, action, steps }) => {
    if (action === 'create') {
      if (!steps) return { error: 'steps required for create' };
      plans.set(id, { steps, completed: 0 });
      return { plan: id, totalSteps: steps.length, status: 'created' };
    }
    if (action === 'complete') {
      const plan = plans.get(id);
      if (!plan) return { error: `Plan not found: ${id}` };
      plan.completed = Math.min(plan.completed + 1, plan.steps.length);
      return { plan: id, completed: plan.completed, total: plan.steps.length };
    }
    const plan = plans.get(id);
    if (!plan) return { error: `Plan not found: ${id}` };
    return { plan: id, completed: plan.completed, total: plan.steps.length, steps: plan.steps };
  },
});
