import { emitKeypressEvents, type Key } from 'readline';
import { loadConfig } from './config.js';
import { runAgentWithRetry, type AgentEvent, type ChatMessage } from './agent.js';
import { initSessionDir, saveMessage, newSessionPath } from './session.js';
import {
  requestPermission,
  resolvePermission,
  getPendingPermission,
  isResolving,
} from './permissions.js';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';

interface ToolCall {
  name: string;
  callId: string;
  args: Record<string, unknown>;
  result?: string;
  startTime: number;
}

interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function summarizeArgs(name: string, args: Record<string, unknown>): string {
  const keyMap: Record<string, string> = {
    run_command: 'command',
    read_file: 'path',
    write_file: 'path',
    search_files: 'pattern',
    grep_files: 'regex',
    list_directory: 'path',
  };
  const key = keyMap[name] ?? Object.keys(args)[0];
  if (!key || !(key in args)) return '';
  const val = String(args[key]);
  return val.length > 50 ? val.slice(0, 50) + '…' : val;
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('mycode must be run in an interactive terminal');
  }

  const config = loadConfig();
  initSessionDir(config.sessionDir);
  const sessionPath = newSessionPath(config.sessionDir);
  const messages: ChatMessage[] = [];
  const history: HistoryEntry[] = [];
  let historyIndex = -1;
  let currentInput = '';
  let cursorPos = 0;
  let abortController: AbortController | null = null;
  let isRunning = false;
  let pendingToolCalls: ToolCall[] = [];

  const width = Math.min(process.stdout.columns || 60, 60);
  const line = GRAY + '─'.repeat(width) + RESET;

  console.log(`\n${line}`);
  console.log(`  ${BOLD}mycode${RESET}  ${DIM}v0.1.0${RESET}`);
  console.log(`  ${DIM}model${RESET}  ${CYAN}${config.model}${RESET}`);
  console.log(`${line}\n`);

  const restoreTerminal = () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  };

  process.on('exit', restoreTerminal);
  process.on('SIGINT', () => {
    restoreTerminal();
    process.exit(130);
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  emitKeypressEvents(process.stdin);

  function redrawInput() {
    process.stdout.write(`\r\x1b[2K`);
    process.stdout.write(`${GREEN}>${RESET} ${currentInput}`);
    const offset = currentInput.length - cursorPos;
    if (offset > 0) process.stdout.write(`\x1b[${offset}D`);
  }

  function printHistory() {
    for (const entry of history) {
      if (entry.role === 'user') {
        console.log(`${CYAN}>>> ${entry.content}${RESET}`);
      } else {
        const lines = entry.content.split('\n');
        for (const l of lines) {
          console.log(`${GREEN}${l}${RESET}`);
        }
        if (entry.toolCalls) {
          for (const tc of entry.toolCalls) {
            if (tc.result) {
              const preview = tc.result.length > 80 ? tc.result.slice(0, 80) + '…' : tc.result;
              console.log(`  ${GRAY}✓ ${tc.name}: ${preview}${RESET}`);
            }
          }
        }
      }
      console.log();
    }
  }

  async function runAssistant(input: string) {
    if (isRunning) return;
    isRunning = true;
    abortController = new AbortController();
    pendingToolCalls = [];

    messages.push({ role: 'user', content: input });
    saveMessage(sessionPath, { role: 'user', content: input });
    history.push({ role: 'user', content: input });
    historyIndex = -1;

    console.log();

    const handleEvent = (event: AgentEvent) => {
      if (event.type === 'text') {
        process.stdout.write(event.delta);
      } else if (event.type === 'tool_call') {
        const tc: ToolCall = {
          name: event.name,
          callId: event.callId,
          args: event.args,
          startTime: Date.now(),
        };
        pendingToolCalls.push(tc);
        if (pendingToolCalls.length === 1) process.stdout.write('\n');
        const args = summarizeArgs(event.name, event.args);
        console.log(`  ${YELLOW}⚡${RESET} ${DIM}${event.name}${RESET}${args ? ' ' + args : ''}`);
      } else if (event.type === 'tool_result') {
        const tc = pendingToolCalls.find((t) => t.callId === event.callId);
        if (tc) {
          tc.result = event.output;
          const ms = Date.now() - tc.startTime;
          console.log(`  ${GREEN}✓${RESET} ${DIM}${tc.name}${RESET} ${GRAY}(${(ms / 1000).toFixed(1)}s)${RESET}`);
        }
      }
    };

    try {
      const result = await runAgentWithRetry(messages, {
        onEvent: handleEvent,
        signal: abortController.signal,
      });

      const lastEntry = history[history.length - 1];
      if (lastEntry.role === 'user') lastEntry.toolCalls = [...pendingToolCalls];

      messages.push({ role: 'assistant', content: result.text });
      saveMessage(sessionPath, { role: 'assistant', content: result.text });
      history.push({ role: 'assistant', content: result.text, toolCalls: [...pendingToolCalls] });

      if (result.usage) {
        console.log(`\n${GRAY}  ${formatTokens(result.usage.inputTokens)} in · ${formatTokens(result.usage.outputTokens)} out${RESET}`);
      }
    } catch (err: any) {
      console.log(`\n${RED}  Error: ${err.message}${RESET}`);
      messages.push({ role: 'assistant', content: `Error: ${err.message}` });
    }

    console.log();
    isRunning = false;
    abortController = null;
    redrawInput();
  }

  function handleKeypress(buffer: string, key: Key) {
    if (isResolving()) {
      if (key.name === 'y' || key.name === 'Y') {
        resolvePermission('allow');
        return;
      } else if (key.name === 'n' || key.name === 'N') {
        resolvePermission('deny');
        return;
      } else if (key.name === 'a' || key.name === 'A') {
        resolvePermission('allow_all');
        return;
      }
    }

    if (key.name === 'return') {
      const input = currentInput.trim();
      currentInput = '';
      cursorPos = 0;
      process.stdout.write('\n');
      if (!input) { redrawInput(); return; }
      runAssistant(input);
      return;
    }

    if (key.name === 'escape') {
      process.stdout.write('\n\nGoodbye!\n');
      process.exit(0);
    }

    if (key.ctrl && key.name === 'c') {
      if (abortController) {
        abortController.abort();
        process.stdout.write('^C\n');
        redrawInput();
      }
      return;
    }

    if (key.ctrl && key.name === 'l') {
      process.stdout.write('\x1b[2J\x1b[H');
      printHistory();
      redrawInput();
      return;
    }

    if (key.name === 'up') {
      if (history.length === 0) return;
      if (historyIndex === -1) historyIndex = history.length - 1;
      else if (historyIndex > 0) historyIndex--;
      if (historyIndex >= 0 && history[historyIndex].role === 'user') {
        currentInput = history[historyIndex].content;
        cursorPos = currentInput.length;
        redrawInput();
      }
      return;
    }

    if (key.name === 'down') {
      if (historyIndex === -1) return;
      if (historyIndex < history.length - 1) {
        historyIndex++;
        currentInput = history[historyIndex].content;
      } else {
        historyIndex = -1;
        currentInput = '';
      }
      cursorPos = currentInput.length;
      redrawInput();
      return;
    }

    if (key.name === 'backspace') {
      if (cursorPos > 0) {
        currentInput = currentInput.slice(0, cursorPos - 1) + currentInput.slice(cursorPos);
        cursorPos--;
        redrawInput();
      }
      return;
    }

    if (key.name === 'delete') {
      if (cursorPos < currentInput.length) {
        currentInput = currentInput.slice(0, cursorPos) + currentInput.slice(cursorPos + 1);
        redrawInput();
      }
      return;
    }

    if (key.name === 'left') {
      if (cursorPos > 0) {
        cursorPos--;
        process.stdout.write('\x1b[D');
      }
      return;
    }

    if (key.name === 'right') {
      if (cursorPos < currentInput.length) {
        cursorPos++;
        process.stdout.write('\x1b[C');
      }
      return;
    }

    if (key.name === 'home') {
      process.stdout.write(`\x1b[${cursorPos}D`);
      cursorPos = 0;
      return;
    }

    if (key.name === 'end') {
      const offset = currentInput.length - cursorPos;
      if (offset > 0) process.stdout.write(`\x1b[${offset}C`);
      cursorPos = currentInput.length;
      return;
    }

    if (key.sequence && key.sequence.length === 1) {
      currentInput = currentInput.slice(0, cursorPos) + key.sequence + currentInput.slice(cursorPos);
      cursorPos++;
      redrawInput();
    }
  }

  process.stdin.on('keypress', handleKeypress);

  console.log(`${DIM}Type /help for commands${RESET}`);
  redrawInput();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
