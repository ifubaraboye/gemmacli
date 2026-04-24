import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

export const searchFilesTool = tool({
  name: 'search_files',
  description: 'Find files by glob pattern. Searches recursively by default from cwd.',
  inputSchema: z.object({
    pattern: z.string(),
    path: z.string().optional(),
  }),
  execute: async (params: Record<string, unknown>) => {
    const { glob } = await import('glob');
    const cwd = (params.path as string) ?? process.cwd();
    const pattern = params.pattern as string;
    try {
      const matches = await glob(pattern, {
        cwd,
        ignore: ['**/node_modules/**', '**/.git/**'],
        absolute: false,
      });
      const capped = matches.slice(0, 1000);
      return {
        files: capped,
        total: matches.length,
        truncated: matches.length > 1000,
      };
    } catch (err: unknown) {
      return { files: [], total: 0, truncated: false, error: String(err) };
    }
  },
});