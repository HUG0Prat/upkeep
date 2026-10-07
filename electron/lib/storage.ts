import { readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir } from './paths';

export function loadJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(dataDir(), name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

const pending = new Map<string, NodeJS.Timeout>();

export function saveJson(name: string, data: unknown): void {
  const prev = pending.get(name);
  if (prev) clearTimeout(prev);
  pending.set(
    name,
    setTimeout(() => {
      pending.delete(name);
      writeFile(join(dataDir(), name), JSON.stringify(data, null, 2), 'utf8').catch((err) =>
        console.error(`[storage] écriture de ${name} impossible :`, err),
      );
    }, 200),
  );
}

export function saveJsonSync(name: string, data: unknown): void {
  writeFileSync(join(dataDir(), name), JSON.stringify(data, null, 2), 'utf8');
}
