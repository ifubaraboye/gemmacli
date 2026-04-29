export interface CommandContext {
  model: string;
  setModel: (model: string) => void;
  messages: { role: string; content: string }[];
  clearMessages: () => void;
  sessionPath: string;
}

export interface SlashCommand {
  name: string;
  description: string;
  execute: (args: string, ctx: CommandContext) => string | void | Promise<string | void>;
}

const commands: SlashCommand[] = [];

export function registerCommand(cmd: SlashCommand): void {
  commands.push(cmd);
}

export function getCommands(): SlashCommand[] {
  return commands;
}

export interface CommandMeta {
  name: string;
  description: string;
}

export function getCommandList(): CommandMeta[] {
  return commands.map((c) => ({ name: c.name, description: c.description }));
}

export interface DispatchResult {
  handled: boolean;
  output?: string;
  clear?: boolean;
}

export async function dispatch(input: string, ctx: CommandContext): Promise<DispatchResult> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return { handled: false };

  const [name, ...rest] = trimmed.slice(1).split(' ');
  const args = rest.join(' ');

  const cmd = commands.find((c) => c.name === name);
  if (!cmd) {
    return { handled: true, output: `Unknown command: /${name}. Type /help for available commands.` };
  }

  const output = await cmd.execute(args, ctx);
  return { handled: true, output: output ?? undefined, clear: name === 'new' };
}

// Register default commands
registerCommand({
  name: 'model',
  description: 'Switch the active model (e.g., /model anthropic/claude-opus-4.7)',
  execute: (args, ctx) => {
    if (!args.trim()) {
      return `Current model: ${ctx.model}`;
    }
    ctx.setModel(args.trim());
    return `Model switched to: ${args.trim()}`;
  },
});

registerCommand({
  name: 'new',
  description: 'Start a fresh conversation',
  execute: (_args, ctx) => {
    ctx.clearMessages();
    return '';
  },
});

registerCommand({
  name: 'help',
  description: 'List available commands',
  execute: () => {
    const lines = ['Commands:'];
    for (const cmd of getCommands()) {
      lines.push(`  /${cmd.name} — ${cmd.description}`);
    }
    return lines.join('\n');
  },
});
