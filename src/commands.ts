import { listSessions, formatSessionTime } from './session.js';

export type SlashResult =
  | { type: 'message'; content: string }
  | { type: 'switch_model'; model: string }
  | { type: 'new_session' }
  | { type: 'exit' };

const HELP_TEXT = `
Available commands:
  /model <name>  - Switch to a different model (e.g. /model anthropic/claude-opus-4)
  /models        - List available OpenRouter models
  /new         - Start a fresh conversation
  /sessions     - List saved sessions
  /compact     - Summarize and compact conversation history
  /tokens      - Show token usage for this session
  /help        - Show this help
  /exit        - Exit the program
`.trim();

async function showSessions(): Promise<SlashResult> {
  const { loadConfig } = await import('./config.js');
  const config = loadConfig();
  const sessions = listSessions(config.sessionDir);

  if (sessions.length === 0) {
    return { type: 'message', content: 'No saved sessions.' };
  }

  const list = sessions
    .slice(0, 10)
    .map((s, i) => `  ${i + 1}. ${formatSessionTime(s)}`)
    .join('\n');

  return { type: 'message', content: `Saved sessions:\n${list}` };
}

export function parseCommand(input: string): { command: string; args: string } | null {
  if (!input.startsWith('/')) return null;

  const trimmed = input.trim();
  const spaceIdx = trimmed.indexOf(' ');

  if (spaceIdx === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: '' };
  }

  return {
    command: trimmed.slice(1, spaceIdx).toLowerCase(),
    args: trimmed.slice(spaceIdx + 1).trim(),
  };
}

export async function executeCommand(input: string): Promise<SlashResult | null> {
  const parsed = parseCommand(input);
  if (!parsed) return null;

  const { command, args } = parsed;

  if (command === 'model' && args) {
    return { type: 'switch_model', model: args };
  }

  if (command === 'model' && !args) {
    return {
      type: 'message',
      content: 'Usage: /model <model-id>\nExample: /model anthropic/claude-sonnet-4-5',
    };
  }

  switch (command) {
    case 'help':
      return { type: 'message', content: HELP_TEXT };
    case 'new':
      return { type: 'new_session' };
    case 'models':
      return { type: 'message', content: 'Run /model without arguments to see available models.' };
    case 'sessions':
      return await showSessions();
    case 'exit':
      return { type: 'exit' };
    default:
      return {
        type: 'message',
        content: `Unknown command: /${command}\n\n${HELP_TEXT}`,
      };
  }
}