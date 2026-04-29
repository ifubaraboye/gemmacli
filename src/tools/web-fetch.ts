import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

export const webFetchTool = tool({
  name: 'web_fetch',
  description: 'Fetch and extract text content from a web page.',
  inputSchema: z.object({
    url: z.string().describe('URL to fetch'),
    maxLength: z.number().optional().describe('Maximum characters to return'),
  }),
  execute: async ({ url, maxLength }) => {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const html = await res.text();
      // Simple HTML-to-text extraction
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const out = maxLength && text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
      return { url, text: out, length: out.length };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});
