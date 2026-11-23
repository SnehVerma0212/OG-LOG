// Secret keys bypass Row Level Security. They must never be handled by browser
// or test code, so anything that is not clearly a publishable (or legacy anon)
// key is treated as privileged.
export function isPrivilegedKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) {
    return true;
  }
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
      return payload.role !== 'anon';
    } catch {
      return true;
    }
  }
  return false;
}
