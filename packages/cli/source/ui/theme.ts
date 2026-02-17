export const colors = {
  brand: "#a78bfa",
  success: "#34d399",
  error: "#f87171",
  warning: "#fbbf24",
  muted: "#6b7280",
  info: "#60a5fa",
} as const;

const BANNERS = [
  `
   ╭─────────────────────────────╮
   │                             │
   │   🦀  simpleclaw  v1.0.0   │
   │                             │
   │   your friendly agent       │
   │   gateway, at your service  │
   │                             │
   ╰─────────────────────────────╯`,
  `
   ╭─────────────────────────────╮
   │                             │
   │   🦞  simpleclaw  v1.0.0   │
   │                             │
   │   pincers ready,            │
   │   tasks loaded.             │
   │                             │
   ╰─────────────────────────────╯`,
  `
   ╭─────────────────────────────╮
   │                             │
   │   🦀  simpleclaw  v1.0.0   │
   │                             │
   │   snip snip.                │
   │   let's get to work.        │
   │                             │
   ╰─────────────────────────────╯`,
];

export function getRandomBanner(): string {
  const index = Math.floor(Math.random() * BANNERS.length);
  return BANNERS[index]!;
}

export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

const TIPS = [
  "Run 'simpleclaw config edit' to tweak your setup interactively.",
  "Use 'simpleclaw service status' to check if the gateway is alive.",
  "Add '--json' to most commands for machine-readable output.",
  "The gateway talks over a local Unix socket — no ports to configure.",
  "Use 'simpleclaw config validate' after manual edits to catch typos.",
  "Your config lives at ~/.simpleclaw/simpleclaw.json by default.",
  "You can override the config path with SIMPLECLAW_CONFIG_PATH.",
];

export function getRandomTip(): string {
  const index = Math.floor(Math.random() * TIPS.length);
  return TIPS[index]!;
}
