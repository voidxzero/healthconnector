import { useFetch } from './data';
import type { PasswordPolicy, ServerStatus } from './api';

/** "At least 6 characters, with an uppercase letter and a number", or nothing if there are no rules to mention. */
export function policyHint(p: PasswordPolicy | null | undefined): string | undefined {
  if (!p) return undefined;
  const needs = [
    p.require_upper && 'an uppercase letter',
    p.require_lower && 'a lowercase letter',
    p.require_digit && 'a number',
    p.require_symbol && 'a symbol',
  ].filter(Boolean) as string[];
  const parts: string[] = [];
  if (p.min_length > 1) parts.push(`At least ${p.min_length} characters`);
  if (needs.length) {
    const list = needs.length > 1 ? needs.slice(0, -1).join(', ') + ' and ' + needs[needs.length - 1] : needs[0];
    parts.push((parts.length ? 'with ' : 'Needs ') + list);
  }
  return parts.join(', ') || undefined;
}

/** The server's current password rules (public, so the first-run screen can show them too). */
export function usePolicy() {
  const st = useFetch<ServerStatus>('/api/status');
  return { policy: st.data?.password_policy ?? null, reload: st.reload };
}
