// Shared import and display boundary for LinkedIn's labeled website entries.
export function profileWebsite(value: unknown): { href: string; label: string; host: string } | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const labeled = /^([^\[\]]+)\s*\[([^\[\]]+)\]$/.exec(trimmed);
  const candidate = (labeled?.[2] ?? trimmed).trim();
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
        /[\\\u0000-\u001f]/.test(candidate)) return null;
    const rawLabel = labeled?.[1].trim();
    let label = rawLabel || url.hostname;
    // A URL or domain with an optional port/path is a claimed destination, not a human title.
    if (rawLabel && /^(?:https?:\/\/)?[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(rawLabel)) {
      label = url.hostname;
    }
    return { href: url.href, label, host: url.hostname };
  } catch {
    return null;
  }
}
