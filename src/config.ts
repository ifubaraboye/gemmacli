import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv(): void {
  const envPath = resolve('.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

loadEnv();

export interface AgentConfig {
  apiKey: string;
  model: string;
  maxSteps: number;
  maxCost: number;
  sessionDir: string;
  allowAll: boolean;
}

const DEFAULTS: AgentConfig = {
  apiKey: '',
  model: 'anthropic/claude-sonnet-4-5',
  maxSteps: 10,
  maxCost: 1.0,
  sessionDir: '.mycode/sessions',
  allowAll: false,
};

export function loadConfig(): AgentConfig {
  const config: AgentConfig = { ...DEFAULTS };

  if (process.env.OPENROUTER_API_KEY) {
    config.apiKey = process.env.OPENROUTER_API_KEY;
  }

  if (process.env.MYCODE_MODEL) {
    config.model = process.env.MYCODE_MODEL;
  }

  if (process.env.MYCODE_MAX_STEPS) {
    config.maxSteps = Number(process.env.MYCODE_MAX_STEPS);
  }

  if (process.env.MYCODE_MAX_COST) {
    config.maxCost = Number(process.env.MYCODE_MAX_COST);
  }

  if (process.env.MYCODE_SESSION_DIR) {
    config.sessionDir = process.env.MYCODE_SESSION_DIR;
  }

  if (!config.apiKey) {
    throw new Error('OPENROUTER_API_KEY is required. Set it in .env or export it.');
  }

  return config;
}