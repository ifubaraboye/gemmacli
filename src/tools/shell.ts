import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const shellTool = tool({
  name: 'shell',
  description: 'Execute a shell command. Use with caution. Output is truncated at 10000 chars.',
  inputSchema: z.object({
    command: z.string().describe('Shell command to execute'),
    timeout: z.number().optional().describe('Timeout in milliseconds (default: 120000)'),
  }),
  execute: async ({ command, timeout }) => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: timeout ?? 120000,
        maxBuffer: 1024 * 1024,
        shell: process.env.SHELL || '/bin/bash',
      });
      const out = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
      return {
        output: out.length > 10000 ? out.slice(0, 10000) + '\n… [truncated]' : out,
        exitCode: 0,
      };
    } catch (err: any) {
      const out = err.stdout ?? '';
      const errOut = err.stderr ?? '';
      const combined = out + (errOut ? `\n[stderr]\n${errOut}` : '');
      return {
        output: combined.length > 10000 ? combined.slice(0, 10000) + '\n… [truncated]' : combined,
        exitCode: err.code ?? 1,
        error: err.message,
      };
    }
  },
});
