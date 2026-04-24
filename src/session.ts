import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  [key: string]: unknown;
};

interface SessionEntry {
  timestamp: string;
  message: Message;
}

export function initSessionDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function saveMessage(sessionPath: string, message: Message): void {
  const entry: SessionEntry = {
    timestamp: new Date().toISOString(),
    message,
  };
  appendFileSync(sessionPath, JSON.stringify(entry) + '\n');
}

export function loadSession(sessionPath: string): Message[] {
  if (!existsSync(sessionPath)) return [];

  return readFileSync(sessionPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        const entry: SessionEntry = JSON.parse(line);
        return entry.message;
      } catch {
        return null;
      }
    })
    .filter((m): m is Message => m !== null);
}

export function listSessions(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .reverse();
}

export function newSessionPath(dir: string): string {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  return join(dir, `${id}.jsonl`);
}

export function formatSessionTime(filename: string): string {
  const id = filename.replace('.jsonl', '');
  const date = new Date(id.replace(/-/g, ':').replace('T', ' '));
  return date.toLocaleString();
}