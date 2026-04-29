import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const grepTool = tool({
  name: 'grep',
  description: 'Search file contents using regex. Uses ripgrep (rg) if available, falls back to grep.',
  inputSchema: z.object({
    pattern: z.string().describe('Regex pattern to search for'),
    path: z.string().optional().describe('Directory or file to search in (default: cwd)'),
    include: z.string().optional().describe('File pattern to include (e.g., "*.ts")'),
  }),
  execute: async ({ pattern, path, include }) => {
    try {
      const target = path ?? process.cwd();
      const cmd = `rg -n ${include ? `--type-add 'custom:${include}' -tcustom ` : ''}"${pattern.replace(/"/g, '\\"')}" "${target}" 2>/dev/null || grep -rn "${pattern.replace(/"/g, '\\"')}" "${target}"`;
      const { stdout } = await execAsync(cmd, { timeout: 15000 });
      const lines = stdout.trim().split('\n').filter(Boolean);
      return { matches: lines, count: lines.length };
    } catch (err: any) {
      if (err.stdout) {
        const lines = err.stdout.trim().split('\n').filter(Boolean);
        return { matches: lines, count: lines.length };
      }
      return { error: err.message, matches: [], count: 0 };
    }
  },
});
