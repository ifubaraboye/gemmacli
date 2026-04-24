import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

export const shellTool = tool({
  name: 'run_command',
  description: 'Execute a shell command and return output. Requires user confirmation for write commands.',
  inputSchema: z.object({
    command: z.string(),
    cwd: z.string().optional(),
    timeout: z.number().default(30),
  }),
  execute: async (params: Record<string, unknown>) => {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { requestPermission } = await import('../../permissions.js');
    const execFileAsync = promisify(execFile);
    const { command, cwd, timeout = 30 } = params as {
      command: string;
      cwd?: string;
      timeout?: number;
    };

    const permissionResult = await requestPermission('run_command', {
      command,
      preview: command.length > 100 ? command.slice(0, 100) + '...' : command,
    });

    if (permissionResult === 'deny') {
      return { output: '', exitCode: 1, denied: true };
    }

    if (permissionResult === 'allow_all' || permissionResult === 'allow') {
      try {
        const opts: { timeout: number; maxBuffer: number; shell: string; cwd?: string } = {
          timeout: timeout * 1000,
          maxBuffer: 256 * 1024,
          shell: process.env.SHELL || '/bin/bash',
        };
        if (cwd) opts.cwd = cwd;
        const { stdout, stderr } = await execFileAsync(command, [], opts);
        return { output: stdout + (stderr || ''), exitCode: 0 };
      } catch (err: unknown) {
        const e = err as { stdout?: Buffer; stderr?: Buffer; code?: number; message?: string };
        return {
          output: e.stdout ? e.stdout.toString() : '',
          stderr: e.stderr ? e.stderr.toString() : '',
          exitCode: e.code ?? 1,
          error: e.message,
        };
      }
    }

    return { output: 'Permission denied', exitCode: 1 };
  },
});