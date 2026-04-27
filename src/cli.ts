import { emitKeypressEvents, type Key } from 'readline';
import { loadConfig } from './config.js';
import { formatAgentError, runAgentWithRetry, type ChatMessage } from './agent.js';
import { TuiRenderer } from './renderer.js';
import { initSessionDir, saveMessage, newSessionPath } from './session.js';
import { detectBg } from './terminal-bg.js';
import { resolvePermission, isResolving } from './permissions.js';
import { Loader } from './loader.js';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[97m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const GREEN = '\x1b[32m';

interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
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
  const inputBg = config.display.inputStyle === 'block' ? await detectBg() : '';
  let historyIndex = -1;

  function renderBanner() {
    const bannerWidth = Math.min(process.stdout.columns || 80, 100);
    const bannerLine = GRAY + '─'.repeat(bannerWidth) + RESET;
    console.log(`\n${bannerLine}`);
    console.log(`  ${BOLD}mycode${RESET} ${DIM}v0.1.0${RESET}`);
    console.log(`  ${DIM}model${RESET}  ${CYAN}${config.model}${RESET}`);
    console.log(`${bannerLine}\n`);
  }

  function renderHistory() {
    for (const entry of history) {
      if (entry.role === 'user') {
        process.stdout.write(`${GREEN}❯${RESET} ${entry.content}\n\n`);
        continue;
      }

      process.stdout.write(`${entry.content}\n\n`);
    }
  }

  function redrawScreen() {
    process.stdout.write('\x1b[2J\x1b[H');
    renderBanner();
    renderHistory();
  }

  renderBanner();

  function styledReadLine(bg: string): Promise<string> {
    return new Promise((resolve) => {
      let line = '';
      let cursorPos = 0;
      let first = true;
      const style = config.display.inputStyle;
      const cwd = process.cwd().replace(process.env.HOME ?? '', '~');

      // Always read live column count so resize is reflected immediately
      function getWidth(): number {
        const cols = process.stdout.columns || 80;
        return style === 'bordered' ? cols : Math.min(cols, 100);
      }

      function getBorderedRule(): string {
        // Avoid writing a full terminal-width rule: many terminals autowrap at the
        // last column, which breaks our relative cursor math during resize redraws.
        const width = Math.max(1, getWidth() - 1);
        return `${DIM}${'─'.repeat(width)}${RESET}`;
      }

      function drawBorderedBox() {
        const rule = getBorderedRule();
        const prompt = `${GREEN}❯${RESET} `;
        process.stdout.write(`\n`);

        process.stdout.write(`\r\x1b[2K${rule}\n`);
        process.stdout.write(`\r\x1b[2K${prompt}${line}\x1b[K\n`);
        process.stdout.write(`\r\x1b[2K${rule}\n`);
        process.stdout.write(`\r\x1b[2K  ${DIM}${cwd}${RESET}`);
        process.stdout.write(`\r\x1b[2A\x1b[${3 + cursorPos}G`);
      }

      function draw() {
        if (style === 'block') {
          if (first) {
            process.stdout.write(`\n${bg}\x1b[K${RESET}\n`);
            process.stdout.write(`${bg}\x1b[K ${WHITE}›${RESET}${bg}${WHITE} ${line}${RESET}\n`);
            process.stdout.write(`${bg}\x1b[K${RESET}\x1b[1A\r\x1b[4G`);
            first = false;
          } else {
            process.stdout.write(`\r${bg}\x1b[K ${WHITE}›${RESET}${bg}${WHITE} ${line}${RESET}`);
            process.stdout.write(`\r\x1b[${4 + cursorPos}G`);
          }
        } else if (style === 'bordered') {
          if (first) {
            drawBorderedBox();
            first = false;
          } else {
            const prompt = `${GREEN}❯${RESET} `;
            process.stdout.write(`\r\x1b[2K${prompt}${line}`);
            process.stdout.write(`\r\x1b[${3 + cursorPos}G`);
          }
        } else {
          const prompt = `${GREEN}❯${RESET} `;
          if (first) {
            process.stdout.write(`${prompt}`);
            first = false;
          } else {
            process.stdout.write(`\r\x1b[2K${prompt}${line}`);
            process.stdout.write(`\r\x1b[${3 + cursorPos}G`);
          }
        }
      }

      // Full redraw triggered on terminal resize — repaints all lines from
      // wherever the cursor currently sits (input line) outward.
      function onResize() {
        if (first) return; // nothing drawn yet

        if (style === 'bordered') {
          redrawScreen();
          drawBorderedBox();
        } else if (style === 'block') {
          process.stdout.write(`\r${bg}\x1b[K ${WHITE}›${RESET}${bg}${WHITE} ${line}${RESET}`);
          process.stdout.write(`\r\x1b[${4 + cursorPos}G`);
        } else {
          const prompt = `${GREEN}❯${RESET} `;
          process.stdout.write(`\r\x1b[2K${prompt}${line}`);
          process.stdout.write(`\r\x1b[${3 + cursorPos}G`);
        }
      }

      draw();

      const onKeypress = (s: string, key: Key) => {
        if (isResolving()) {
          if (key.name === 'y') resolvePermission('allow');
          else if (key.name === 'n') resolvePermission('deny');
          else if (key.name === 'a') resolvePermission('allow_all');
          return;
        }

        if (key.name === 'return') {
          cleanup();
          if (style === 'bordered') {
            process.stdout.write(`\x1b[2B\n`);
          } else if (style === 'block') {
            process.stdout.write(`${RESET}\n`);
          } else {
            process.stdout.write('\n');
          }
          resolve(line);
        } else if (key.name === 'backspace') {
          if (cursorPos > 0) {
            line = line.slice(0, cursorPos - 1) + line.slice(cursorPos);
            cursorPos--;
            draw();
          }
        } else if (key.name === 'delete') {
          if (cursorPos < line.length) {
            line = line.slice(0, cursorPos) + line.slice(cursorPos + 1);
            draw();
          }
        } else if (key.name === 'left') {
          if (cursorPos > 0) {
            cursorPos--;
            draw();
          }
        } else if (key.name === 'right') {
          if (cursorPos < line.length) {
            cursorPos++;
            draw();
          }
        } else if (key.name === 'up') {
          if (history.length > 0) {
            if (historyIndex === -1) historyIndex = history.length - 1;
            else if (historyIndex > 0) historyIndex--;

            while (historyIndex >= 0 && history[historyIndex].role !== 'user') {
              historyIndex--;
            }

            if (historyIndex >= 0) {
              line = history[historyIndex].content;
              cursorPos = line.length;
              draw();
            }
          }
        } else if (key.name === 'down') {
          if (historyIndex !== -1) {
            historyIndex++;
            while (historyIndex < history.length && history[historyIndex].role !== 'user') {
              historyIndex++;
            }
            if (historyIndex < history.length) {
              line = history[historyIndex].content;
            } else {
              historyIndex = -1;
              line = '';
            }
            cursorPos = line.length;
            draw();
          }
        } else if (key.ctrl && key.name === 'c') {
          process.stdout.write('\x1b[?25h\n');
          process.exit(0);
        } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          line = line.slice(0, cursorPos) + key.sequence + line.slice(cursorPos);
          cursorPos++;
          draw();
        }
      };

      function cleanup() {
        process.stdin.removeListener('keypress', onKeypress);
        process.stdout.removeListener('resize', onResize);
        process.stdin.setRawMode(false);
        process.stdin.pause();
      }

      process.stdin.setRawMode(true);
      process.stdin.resume();
      emitKeypressEvents(process.stdin);
      process.stdin.on('keypress', onKeypress);
      process.stdout.on('resize', onResize); // fires on SIGWINCH (Ctrl+/Ctrl- zoom, window drag)
    });
  }

  while (true) {
    const input = await styledReadLine(inputBg);
    const trimmed = input.trim();
    if (!trimmed) continue;

    if (config.display.inputStyle !== 'bordered') {
      const cwd = process.cwd().replace(process.env.HOME ?? '', '~');
      process.stdout.write(`\x1b[K  ${DIM}${cwd}${RESET}\n\n`);
    } else {
      process.stdout.write(`\n`);
    }

    messages.push({ role: 'user', content: trimmed });
    saveMessage(sessionPath, { role: 'user', content: trimmed });
    history.push({ role: 'user', content: trimmed });
    historyIndex = -1;

    let started = false;
    const loader = new Loader('Thinking', (text) => {
      process.stdout.write(text);
    });

    loader.start();

    const renderer = new TuiRenderer({
      display: config.display,
      beforeWrite: () => {
        if (!started) {
          started = true;
          loader.stop();
        }
      }
    });

    try {
      const result = await runAgentWithRetry(messages, {
        onEvent: (event) => renderer.handle(event),
      });
      loader.stop();
      renderer.endTurn();

      messages.push({ role: 'assistant', content: result.text });
      saveMessage(sessionPath, { role: 'assistant', content: result.text });
      history.push({ role: 'assistant', content: result.text });

      const inT = result.usage?.inputTokens ?? 0;
      const outT = result.usage?.outputTokens ?? 0;
      console.log(`\n${GRAY}  ${formatTokens(inT)} in · ${formatTokens(outT)} out${RESET}\n`);
    } catch (err: any) {
      loader.stop();
      renderer.endTurn();
      const message = formatAgentError(err);
      console.log(`\n${RED}  Error: ${message}${RESET}\n`);
      messages.push({ role: 'assistant', content: `Error: ${message}` });
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
