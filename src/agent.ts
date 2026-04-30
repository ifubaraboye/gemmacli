import { OpenRouter } from '@openrouter/agent';
import type { Item } from '@openrouter/agent';
import { stepCountIs, maxCost } from '@openrouter/agent/stop-conditions';
import type { AgentConfig } from './config.js';
import { tools } from './tools/index.js';

export type TextContent = { type: 'input_text'; text: string };
export type ImageContent = { type: 'input_image'; imageUrl: string; detail: 'auto' };

export type ChatMessage =
  | { role: 'assistant' | 'system'; content: string }
  | { role: 'user'; content: string | Array<TextContent | ImageContent> };

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; callId: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; callId: string; output: string }
  | { type: 'reasoning'; delta: string };

export type ToolResultData = {
  name: string;
  callId: string;
  output: unknown;
};

export async function runAgent(
  config: AgentConfig,
  input: string | ChatMessage[],
  options?: {
    onEvent?: (event: AgentEvent) => void;
    onToolResult?: (data: ToolResultData) => void;
    signal?: AbortSignal;
    skillInstructions?: string;
  },
) {
  const client = new OpenRouter({ apiKey: config.apiKey });

  let instructions = config.systemPrompt.replace('{cwd}', process.cwd());
  if (options?.skillInstructions) {
    instructions = options.skillInstructions + '\n\n' + instructions;
  }

  const result = client.callModel({
    model: config.model,
    instructions,
    input: input as string | Item[],
    tools,
    stopWhen: [stepCountIs(config.maxSteps), maxCost(config.maxCost)],
  });

  if (options?.onEvent) {
    let lastTextLen = 0;
    const callNames = new Map<string, string>();

    for await (const item of result.getItemsStream()) {
      if (options?.signal?.aborted) break;
      if (item.type === 'message') {
        let text = '';
        if (typeof item.content === 'string') {
          text = item.content;
        } else if (Array.isArray(item.content)) {
          text = item.content
            .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
            .join('');
        }
        if (text.length > lastTextLen) {
          options.onEvent({ type: 'text', delta: text.slice(lastTextLen) });
          lastTextLen = text.length;
        }
      } else if (item.type === 'function_call') {
        callNames.set(item.callId, item.name);
        if (item.status === 'completed') {
          const args = (() => { try { return item.arguments ? JSON.parse(item.arguments) : {}; } catch { return {}; } })();
          options.onEvent({ type: 'tool_call', name: item.name, callId: item.callId, args });
        }
      } else if (item.type === 'function_call_output') {
        const out = typeof item.output === 'string' ? item.output : JSON.stringify(item.output);
        const toolName = callNames.get(item.callId) ?? '';
        const shouldNotTruncate = toolName === 'file_edit' || toolName === 'file_write';
        const structuredOutput = typeof item.output === 'string' ? JSON.parse(item.output) : item.output;
        options.onToolResult?.({
          name: toolName,
          callId: item.callId,
          output: structuredOutput,
        });
        if (options?.onEvent) {
          options.onEvent({
            type: 'tool_result',
            name: toolName,
            callId: item.callId,
            output: shouldNotTruncate ? out : (out.length > 200 ? out.slice(0, 200) + '…' : out),
          });
        }
      } else if (item.type === 'reasoning') {
        const text = item.summary?.map((s: { text: string }) => s.text).join('') ?? '';
        if (text) options.onEvent({ type: 'reasoning', delta: text });
      }
    }
  }

  const response = await result.getResponse();
  return { text: response.outputText ?? '', usage: response.usage, output: response.output };
}

export async function runAgentWithRetry(
  config: AgentConfig,
  input: string | ChatMessage[],
  options?: {
    onEvent?: (event: AgentEvent) => void;
    onToolResult?: (data: ToolResultData) => void;
    signal?: AbortSignal;
    maxRetries?: number;
    skillInstructions?: string;
  },
) {
  for (let attempt = 0, max = options?.maxRetries ?? 3; attempt <= max; attempt++) {
    try { return await runAgent(config, input, options); }
    catch (err: any) {
      const s = err?.status ?? err?.statusCode;
      if (!(s === 429 || (s >= 500 && s < 600)) || attempt === max) throw err;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 30000)));
    }
  }
  throw new Error('Unreachable');
}
