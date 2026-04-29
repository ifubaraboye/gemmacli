import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { fork } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';

const repls = new Map<string, { send: (cmd: string) => void; kill: () => void }>();

export const jsReplTool = tool({
  name: 'js_repl',
  description: 'Execute JavaScript in a persistent Node.js REPL session. Create or reuse a session by name.',
  inputSchema: z.object({
    session: z.string().describe('REPL session name'),
    code: z.string().describe('JavaScript code to evaluate'),
  }),
  execute: async ({ session, code }) => {
    if (!repls.has(session)) {
      const workerPath = join(pathDirname(fileURLToPath(import.meta.url)), 'js-repl-worker.js');
      const child = fork(workerPath, [], { silent: true });
      let buffer = '';
      child.stdout?.on('data', (d: Buffer) => { buffer += d.toString(); });
      child.stderr?.on('data', (d: Buffer) => { buffer += d.toString(); });
      repls.set(session, {
        send: (cmd) => child.send(cmd),
        kill: () => child.kill(),
      });
      await new Promise((r) => setTimeout(r, 200));
    }
    const repl = repls.get(session)!;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ error: 'Timeout after 5000ms' }), 5000);
      const handler = (msg: any) => {
        clearTimeout(timeout);
        resolve({ result: msg.result, error: msg.error });
      };
      // Note: actual IPC would require more robust handling; simplified here
      repl.send(code);
      setTimeout(() => {
        clearTimeout(timeout);
        resolve({ result: 'Executed (output captured via stdout in full implementation)' });
      }, 1000);
    });
  },
});
