import { mkdir, readFile, writeFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function initSessionDir(dir: string): Promise<void> {
  const path = resolve(dir);
  try {
    await mkdir(path, { recursive: true });
  } catch {
    // ignore
  }
}

export function newSessionPath(dir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(resolve(dir), `${timestamp}.jsonl`);
}

export async function saveMessage(sessionPath: string, message: SessionMessage): Promise<void> {
  const entry = { timestamp: new Date().toISOString(), message };
  await writeFile(sessionPath, JSON.stringify(entry) + '\n', { flag: 'a' });
}

export async function loadSession(sessionPath: string): Promise<SessionMessage[]> {
  try {
    const content = await readFile(sessionPath, 'utf-8');
    const lines = content.trim().split('\n');
    const messages: SessionMessage[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.message) messages.push(entry.message);
      } catch {
        // skip malformed lines
      }
    }
    return messages;
  } catch {
    return [];
  }
}

export async function listSessions(dir: string): Promise<string[]> {
  try {
    const files = await readdir(resolve(dir));
    return files.filter((f: string) => f.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }
}
