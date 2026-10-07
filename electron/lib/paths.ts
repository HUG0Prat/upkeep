import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function isPortable(): boolean {
  return !!process.env.PORTABLE_EXECUTABLE_DIR;
}

function migrateLegacy(legacy: string, dir: string): void {
  if (!existsSync(legacy) || existsSync(join(dir, 'settings.json'))) return;
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(legacy)) {
    if (existsSync(join(dir, entry))) continue;
    try {
      renameSync(join(legacy, entry), join(dir, entry));
    } catch {}
  }
  try {
    rmdirSync(legacy);
  } catch {}
}

export function dataDir(): string {
  if (process.env.UPKEEP_DATA) {
    mkdirSync(process.env.UPKEEP_DATA, { recursive: true });
    return process.env.UPKEEP_DATA;
  }
  const base = isPortable() ? process.env.PORTABLE_EXECUTABLE_DIR! : (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'));
  const dir = join(base, isPortable() ? 'UpKeep-data' : 'UpKeep');
  migrateLegacy(join(base, isPortable() ? 'AutoMajs-data' : 'AutoMajs'), dir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function downloadsDir(): string {
  const dir = join(dataDir(), 'downloads');
  mkdirSync(dir, { recursive: true });
  return dir;
}
