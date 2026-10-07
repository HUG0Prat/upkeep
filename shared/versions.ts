const PRE_RE = /(alpha|beta|preview|pre|rc|insider|canary|nightly|dev|snapshot)/i;

export function isPreviewVersion(v?: string): boolean {
  return !!v && PRE_RE.test(v);
}

type Part = number | string;

function parse(v: string): { main: Part[]; pre: Part[] } {
  const clean = v.trim().replace(/^v/i, '').split('+')[0];
  const dash = clean.search(/[-~]/);
  const mainStr = dash >= 0 ? clean.slice(0, dash) : clean;
  const preStr = dash >= 0 ? clean.slice(dash + 1) : '';
  const split = (s: string): Part[] =>
    s
      .split(/[._\s]/)
      .filter(Boolean)
      .flatMap((seg) => seg.match(/\d+|[^\d]+/g) ?? [])
      .map((x) => (/^\d+$/.test(x) ? Number(x) : x.toLowerCase()));
  const main = split(mainStr);
  const firstAlpha = main.findIndex((p) => typeof p === 'string');
  if (!preStr && firstAlpha > 0 && PRE_RE.test(String(main[firstAlpha]))) {
    return { main: main.slice(0, firstAlpha), pre: main.slice(firstAlpha) };
  }
  return { main, pre: split(preStr) };
}

function cmpParts(a: Part[], b: Part[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    if (typeof x === 'number') return 1;
    if (typeof y === 'number') return -1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function compareVersions(a?: string, b?: string): number {
  if (!a || !b || !/\d/.test(a) || !/\d/.test(b)) return NaN;
  const pa = parse(a);
  const pb = parse(b);
  const main = cmpParts(pa.main, pb.main);
  if (main !== 0) return main;
  if (!pa.pre.length && pb.pre.length) return 1;
  if (pa.pre.length && !pb.pre.length) return -1;
  return cmpParts(pa.pre, pb.pre);
}

export function isNewer(available?: string, current?: string): boolean {
  const c = compareVersions(available, current);
  return Number.isNaN(c) ? true : c > 0;
}

export function majorOf(v?: string): string | undefined {
  if (!v) return undefined;
  return v.replace(/^v/i, '').match(/^\d+/)?.[0];
}
