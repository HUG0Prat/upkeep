import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { powershell, powershellJson, psQuote, run, safeId } from '../lib/exec';
import { fetchJson } from '../lib/http';
import type { ElevatedOp } from '../lib/elevatedOps';
import { fetchInstaller } from './gpu';
import { makeKey, type Provider } from './types';
import { isNewer } from '../../shared/versions';
import { t } from '../../shared/i18n';
import type { Severity, UpdateItem, UpdateKind } from '../../shared/types';

function severityFrom(text?: string | null): Severity | undefined {
  const s = (text ?? '').toLowerCase();
  if (/critical|critique|urgent/.test(s)) return 'critical';
  if (/important|recommended|recommandé/.test(s)) return 'recommended';
  if (/optional|facultati/.test(s)) return 'optional';
  return undefined;
}


export interface LsuUpdate {
  ID: string;
  Title: string;
  Category: string | null;
  Version: string | null;
  Severity: string | null;
  RebootType: string | null;
  Type: string | null;
  Size: number | null;
  Readme: string | null;
  ReleaseDate: string | null;
}

let lsuModulePath = '';
let lsuNote: string | undefined;

function lenovoKind(type: string | null, title: string): UpdateKind {
  const s = (type ?? '').toLowerCase();
  if (s === 'bios' || s === 'firmware' || /bios|firmware|uefi/i.test(title)) return 'firmware';
  if (s === 'application') return 'package';
  return 'driver';
}

export function mapLsuUpdate(u: LsuUpdate, biosVersion: string): UpdateItem {
  const kind = lenovoKind(u.Type, u.Title);
  const isBios = (u.Type ?? '').toLowerCase() === 'bios' || /\bbios\b/i.test(u.Title);
  const severity = severityFrom(u.Severity);
  return {
    key: makeKey('lenovo', u.ID),
    providerId: 'lenovo',
    kind,
    id: u.ID,
    name: u.Title,
    currentVersion: isBios ? biosVersion : undefined,
    availableVersion: u.Version ?? undefined,
    publishedAt: u.ReleaseDate ? Date.parse(u.ReleaseDate) || undefined : undefined,
    source: 'Lenovo',
    category: u.Category ?? u.Type ?? undefined,
    details: u.Severity ? `Criticité : ${u.Severity}` : undefined,
    severity,
    security: severity === 'critical',
    releaseNotesUrl: u.Readme ?? undefined,
    sizeBytes: u.Size ?? undefined,
    requiresReboot: kind === 'firmware' || (u.RebootType ?? '0') !== '0',
    requiresAdmin: true,
    supportsDownload: true,
  };
}

export const lenovoProvider: Provider = {
  id: 'lenovo',
  name: 'Lenovo (BIOS, firmware, pilotes)',
  kind: 'firmware',
  group: 'Pilotes & firmware',
  description: 'Catalogue constructeur Lenovo via le module PowerShell LSUClient',
  isApplicable: (sys) => /lenovo/i.test(sys.manufacturer),
  note: () => lsuNote,
  async detect() {
    const res = await powershell('$m = Get-Module -ListAvailable LSUClient | Sort-Object Version -Descending | Select-Object -First 1; if ($m) { $m.Path }', {
      timeoutMs: 30_000,
    });
    lsuModulePath = res.stdout.trim();
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    lsuNote =
      lsuModulePath && !lsuModulePath.toLowerCase().startsWith(pf.toLowerCase())
        ? 'LSUClient est installé pour votre seul compte : l’assistant administrateur ne pourra pas l’utiliser (action « pour tous les utilisateurs »).'
        : undefined;
    return !!lsuModulePath;
  },
  async check(ctx) {
    const raw = await powershellJson<LsuUpdate[]>(
      String.raw`
Import-Module ${psQuote(lsuModulePath || 'LSUClient')}
$out = Get-LSUpdate | ForEach-Object {
  $readme = $_.Files | Where-Object { "$($_.Kind)" -match 'Readme' } | Select-Object -First 1
  [pscustomobject]@{
    ID = $_.ID; Title = $_.Title; Category = $_.Category; Version = $_.Version
    Severity = [string]$_.Severity; RebootType = [string]$_.RebootType; Type = [string]$_.Type
    Size = ($_.Files | Where-Object { $_.Size } | Measure-Object -Property Size -Sum).Sum
    Readme = if ($readme) { [string]$readme.AbsoluteLocation } else { $null }
    ReleaseDate = if ($_.PSObject.Properties['ReleaseDate'] -and $_.ReleaseDate) { [string]$_.ReleaseDate } else { $null }
  }
}
if (@($out).Count) { ConvertTo-Json -InputObject @($out) -Depth 3 -Compress }`,
      { timeoutMs: ctx.timeoutMs },
    );
    ctx.trace('Get-LSUpdate', JSON.stringify(raw, null, 1));
    return [raw].flat().filter(Boolean).map((u) => mapLsuUpdate(u, ctx.system.biosVersion));
  },
  async download(items, ctx) {
    const ids = items.map((i) => psQuote(safeId(i.id))).join(',');
    const res = await powershell(
      `Import-Module ${psQuote(lsuModulePath || 'LSUClient')}; $w = @(${ids}); Get-LSUpdate | Where-Object { $w -contains $_.ID } | Save-LSUpdate -ShowProgress:$false -Verbose *>&1 | ForEach-Object { "$_" }`,
      { onLine: ctx.log, timeoutMs: 60 * 60_000, signal: ctx.signal },
    );
    return { success: res.code === 0 };
  },
  async elevatedOps(items) {
    return [{ op: 'lenovo-install', ids: items.map((i) => safeId(i.id)), module: lsuModulePath }];
  },
  setup: {
    label: 'Installer le module LSUClient',
    async run(log) {
      log(t('Installation du module LSUClient depuis PowerShell Gallery (portée utilisateur)…'));
      const res = await powershell(
        'Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force | Out-Null;' +
          'Install-Module LSUClient -Scope CurrentUser -Force -AllowClobber; "OK"',
        { onLine: log, timeoutMs: 10 * 60_000 },
      );
      return res.code === 0;
    },
  },
  actions: [
    {
      id: 'lsu-allusers',
      label: 'Installer LSUClient pour tous les utilisateurs',
      elevatedOps: () => [{ op: 'psgallery-install-allusers', name: 'LSUClient' }],
      async run() {
        return true;
      },
    },
  ],
};


const DCU = ['C:\\Program Files\\Dell\\CommandUpdate\\dcu-cli.exe', 'C:\\Program Files (x86)\\Dell\\CommandUpdate\\dcu-cli.exe'];
const findDcu = () => DCU.find((p) => existsSync(p));
const dellFiles = new Map<string, string>();

function tag(xml: string, name: string): string | undefined {
  return xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i'))?.[1]?.trim();
}

function dellKind(type = ''): UpdateKind {
  const s = type.toLowerCase();
  if (s.includes('bios') || s.includes('firmware')) return 'firmware';
  if (s.includes('application') || s.includes('utility')) return 'package';
  return 'driver';
}

export function parseDellReport(xml: string, biosVersion: string): (UpdateItem & { file?: string })[] {
  return [...xml.matchAll(/<update>([\s\S]*?)<\/update>/gi)].map((m) => {
    const u = m[1];
    const release = tag(u, 'release') ?? tag(u, 'name') ?? 'inconnu';
    const type = tag(u, 'type');
    const kind = dellKind(type);
    const urgency = tag(u, 'urgency');
    const date = tag(u, 'date');
    return {
      key: makeKey('dell', release),
      providerId: 'dell',
      kind,
      id: release,
      name: tag(u, 'name') ?? release,
      currentVersion: type?.toLowerCase() === 'bios' ? biosVersion : undefined,
      availableVersion: tag(u, 'version'),
      publishedAt: date ? Date.parse(date) || undefined : undefined,
      source: 'Dell',
      category: type,
      details: urgency ? `Urgence : ${urgency}` : undefined,
      severity: severityFrom(urgency),
      security: /urgent|critical/i.test(urgency ?? ''),
      sizeBytes: Number(tag(u, 'bytes')) || undefined,
      requiresReboot: kind === 'firmware',
      requiresAdmin: true,
      file: tag(u, 'file'),
    };
  });
}

export const dellProvider: Provider = {
  id: 'dell',
  name: 'Dell Command | Update',
  kind: 'firmware',
  group: 'Pilotes & firmware',
  description: 'BIOS, firmware et pilotes Dell via dcu-cli',
  isApplicable: (sys) => /dell/i.test(sys.manufacturer),
  detect: async () => !!findDcu(),
  async check(ctx) {
    const cli = findDcu();
    if (!cli) return [];
    const dir = await mkdtemp(join(tmpdir(), 'upkeep-dcu-'));
    try {
      const r = await run(cli, ['/scan', `-report=${dir}`, '-silent'], { timeoutMs: ctx.timeoutMs });
      ctx.trace('dcu-cli /scan', r.stdout + r.stderr);
      const xml = await readFile(join(dir, 'DCUApplicableUpdates.xml'), 'utf8').catch(() => '');
      ctx.trace('DCUApplicableUpdates.xml', xml);
      return parseDellReport(xml, ctx.system.biosVersion).map(({ file, ...item }) => {
        if (file) dellFiles.set(item.key, file);
        return item;
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  async elevatedOps(items, ctx) {
    const ops: ElevatedOp[] = [];
    const byCategory: string[] = [];
    for (const i of items) {
      const file = dellFiles.get(i.key);
      if (file && i.kind !== 'firmware') {
        const exe = await fetchInstaller(`https://dl.dell.com/${file.replace(/^\/+/, '')}`, 'dell', ctx, /Dell/i);
        ops.push({ op: 'run-installer', vendor: 'dell', path: exe.path, sha256: exe.sha256 });
      } else {
        byCategory.push((i.category ?? 'others').toLowerCase());
      }
    }
    if (byCategory.length) ops.push({ op: 'dell-apply', types: [...new Set(byCategory)] });
    return ops;
  },
  setup: {
    label: 'Installer Dell Command | Update (winget)',
    async run(log) {
      const res = await run(
        'winget',
        ['install', '--id', 'Dell.CommandUpdate', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements'],
        { onLine: log, timeoutMs: 20 * 60_000 },
      );
      return res.code === 0;
    },
  },
};


const HPIA = [
  'C:\\SWSetup\\HPImageAssistant\\HPImageAssistant.exe',
  'C:\\Program Files\\HP\\HPIA\\HPImageAssistant.exe',
  'C:\\Program Files\\HP\\HP Image Assistant\\HPImageAssistant.exe',
];
const findHpia = () => HPIA.find((p) => existsSync(p));
const hpUrls = new Map<string, string>();

interface HpRecommendation {
  TargetComponent?: string;
  TargetVersion?: string;
  ReferenceVersion?: string;
  Comments?: string;
  Type?: string;
  RecommendationValue?: string;
  SoftPaq?: { Id?: string; Name?: string; Version?: string; Size?: number; ReleaseNotesUrl?: string; Url?: string };
}

export function parseHpReport(json: string): (UpdateItem & { url?: string })[] {
  const j = JSON.parse(json) as { HPIA?: { Recommendations?: HpRecommendation[] } };
  return (j.HPIA?.Recommendations ?? []).map((r) => {
    const type = (r.Type ?? r.TargetComponent ?? '').toLowerCase();
    const kind: UpdateKind = /bios|firmware/.test(type) ? 'firmware' : /software|application/.test(type) ? 'package' : 'driver';
    const id = r.SoftPaq?.Id ?? r.TargetComponent ?? 'hp';
    return {
      key: makeKey('hp', id),
      providerId: 'hp',
      kind,
      id,
      name: r.SoftPaq?.Name ?? r.TargetComponent ?? id,
      currentVersion: r.TargetVersion,
      availableVersion: r.ReferenceVersion ?? r.SoftPaq?.Version,
      source: 'HP',
      category: r.Type ?? r.TargetComponent,
      details: r.Comments,
      severity: severityFrom(r.RecommendationValue),
      releaseNotesUrl: r.SoftPaq?.ReleaseNotesUrl,
      sizeBytes: r.SoftPaq?.Size,
      requiresReboot: kind === 'firmware',
      requiresAdmin: true,
      url: r.SoftPaq?.Url,
    };
  });
}

export const hpProvider: Provider = {
  id: 'hp',
  name: 'HP Image Assistant',
  kind: 'firmware',
  group: 'Pilotes & firmware',
  description: 'BIOS, firmware et pilotes HP analysés par HP Image Assistant',
  experimental: true,
  isApplicable: (sys) => /hp|hewlett/i.test(sys.manufacturer),
  detect: async () => !!findHpia(),
  async check(ctx) {
    const exe = findHpia();
    if (!exe) return [];
    const dir = await mkdtemp(join(tmpdir(), 'upkeep-hpia-'));
    try {
      const r = await run(exe, ['/Operation:Analyze', '/Action:List', '/Category:All', '/Selection:All', '/Silent', `/ReportFolder:${dir}`], {
        timeoutMs: ctx.timeoutMs,
      });
      ctx.trace('HPImageAssistant /Operation:Analyze', r.stdout + r.stderr);
      const json = (await readdir(dir)).find((f) => f.toLowerCase().endsWith('.json'));
      if (!json) return [];
      const text = await readFile(join(dir, json), 'utf8');
      ctx.trace('Rapport HPIA', text);
      return parseHpReport(text).map(({ url, ...item }) => {
        if (url) hpUrls.set(item.key, url);
        return item;
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  async elevatedOps(items, ctx) {
    const ops: ElevatedOp[] = [];
    const cats = new Set<string>();
    for (const i of items) {
      const url = hpUrls.get(i.key);
      if (url && i.kind !== 'firmware') {
        const exe = await fetchInstaller(url.replace(/^ftp:/i, 'https:'), 'hp', ctx, /HP/i);
        ops.push({ op: 'run-installer', vendor: 'hp', path: exe.path, sha256: exe.sha256 });
      } else {
        cats.add(i.kind === 'firmware' ? (/bios/i.test(i.category ?? '') ? 'BIOS' : 'Firmware') : i.kind === 'package' ? 'Software' : 'Drivers');
      }
    }
    if (cats.size) ops.push({ op: 'hp-install', categories: [...cats] });
    return ops;
  },
  setup: {
    label: 'Installer HP Image Assistant (winget)',
    async run(log) {
      const res = await run('winget', ['install', '--id', 'HP.ImageAssistant', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements'], {
        onLine: log,
        timeoutMs: 20 * 60_000,
      });
      return res.code === 0;
    },
  },
};


interface AsusFile {
  Version: string;
  Title: string;
  ReleaseDate: string;
  FileSize: string;
  DownloadUrl: { Global?: string };
  sha256?: string;
  Description?: string;
}

export function asusModelCode(model: string): string {
  const last = model.trim().split(/\s+/).pop() ?? model;
  return last.split('_')[0];
}

export function asusBiosVersion(bios: string): string {
  return bios.includes('.') ? bios.split('.').pop()! : bios;
}

const asusFiles = new Map<string, AsusFile>();

export const asusProvider: Provider = {
  id: 'asus',
  name: 'ASUS (BIOS)',
  kind: 'firmware',
  group: 'Pilotes & firmware',
  description: 'BIOS publié sur le site de support ASUS pour votre modèle',
  experimental: true,
  isApplicable: (sys) => /asus/i.test(sys.manufacturer),
  detect: async () => true,
  async check(ctx) {
    const code = asusModelCode(ctx.system.model);
    const j = await fetchJson<{ Result: { Obj: { Name: string; Files: AsusFile[] }[] } | null }>(
      `https://www.asus.com/support/api/product.asmx/GetPDBIOS?website=global&model=${encodeURIComponent(code)}&pdhashedid=&cpu=`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    );
    ctx.trace(`ASUS GetPDBIOS ${code}`, JSON.stringify(j, null, 1).slice(0, 20000));
    const group = j.Result?.Obj.find((o) => /windows/i.test(o.Name)) ?? j.Result?.Obj.find((o) => /bios/i.test(o.Name));
    const f = group?.Files[0];
    const current = asusBiosVersion(ctx.system.biosVersion);
    if (!f || !isNewer(f.Version, current)) return [];
    asusFiles.set(code, f);
    return [
      {
        key: makeKey('asus', code),
        providerId: 'asus',
        kind: 'firmware',
        id: code,
        name: `${f.Title} (${code})`,
        currentVersion: current,
        availableVersion: f.Version,
        publishedAt: Date.parse(f.ReleaseDate.replace(/\//g, '-')) || undefined,
        source: 'ASUS',
        category: 'BIOS',
        details: f.Description?.replace(/<[^>]+>/g, ' ').slice(0, 160),
        homepage: `https://www.asus.com/support/searchresult/?searchType=support&searchKey=${code}`,
        requiresReboot: true,
        requiresAdmin: true,
        supportsDownload: /windows/i.test(group?.Name ?? ''),
      },
    ];
  },
  async elevatedOps(items, ctx) {
    const f = asusFiles.get(items[0].id);
    const url = f?.DownloadUrl.Global;
    if (!f || !url || !/\.exe/i.test(url)) throw new Error(t('Pas d’installeur Windows pour ce BIOS : mettez-le à jour depuis l’UEFI (EZ Flash).'));
    const exe = await fetchInstaller(url, 'asus', ctx, /ASUS|ASUSTeK/i);
    if (f.sha256 && exe.sha256.toLowerCase() !== f.sha256.toLowerCase()) throw new Error(t('Empreinte SHA-256 différente de celle publiée par ASUS.'));
    if (ctx.downloadOnly) return [{ op: 'simulate', text: t('Téléchargé : {path}', { path: exe.path }) }];
    return [{ op: 'run-installer', vendor: 'asus', path: exe.path, sha256: exe.sha256 }];
  },
};
