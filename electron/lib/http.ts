import { createWriteStream } from 'node:fs';
import { powershellJson, psQuote } from './exec';

const UA = `UpKeep/${process.env.npm_package_version ?? '1'} (desktop update checker for Windows)`;

export async function fetchText(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${new URL(url).host}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  return JSON.parse(await fetchText(url, { ...init, headers: { Accept: 'application/json', ...(init.headers ?? {}) } })) as T;
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function download(
  url: string,
  dest: string,
  onProgress?: (pct: number, done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal });
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const file = createWriteStream(dest);
  let done = 0;
  let last = -1;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      done += value.length;
      if (!file.write(value)) await new Promise((r) => file.once('drain', r));
      const pct = total ? Math.floor((done / total) * 100) : -1;
      if (pct !== last) {
        last = pct;
        onProgress?.(pct, done, total);
      }
    }
  } finally {
    await new Promise<void>((r) => file.end(r));
  }
}

export interface SignatureInfo {
  status: string;
  signer?: string;
  valid: boolean;
}

export async function verifySignature(path: string): Promise<SignatureInfo> {
  const r = await powershellJson<{ Status: string; Signer?: string }>(
    `$s = Get-AuthenticodeSignature -LiteralPath ${psQuote(path)}; ` +
      `[pscustomobject]@{ Status = [string]$s.Status; Signer = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null } } | ConvertTo-Json -Compress`,
    { timeoutMs: 60_000 },
  );
  return { status: r.Status, signer: r.Signer, valid: r.Status === 'Valid' };
}
