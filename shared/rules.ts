import type { Rule, RuleAction, UpdateItem } from './types';

export function globToRegex(pattern: string): RegExp {
  const bounded = pattern.trim().slice(0, 200).replace(/\*{2,}/g, '*');
  const esc = bounded.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

export function ruleMatches(rule: Rule, item: UpdateItem): boolean {
  if (!rule.enabled || !rule.pattern.trim()) return false;
  const re = globToRegex(rule.pattern);
  const fields: Record<string, (string | undefined)[]> = {
    name: [item.name],
    id: [item.id],
    source: [item.source, item.providerId],
    publisher: [item.publisher],
    any: [item.name, item.id, item.source, item.providerId, item.publisher],
  };
  return (fields[rule.field] ?? fields.any).some((v) => !!v && re.test(v));
}

export function ruleActions(rules: Rule[], item: UpdateItem): Set<RuleAction> {
  const out = new Set<RuleAction>();
  for (const r of rules) if (ruleMatches(r, item)) out.add(r.action);
  return out;
}
