import pc from "picocolors";

export const c = {
  brand: pc.magenta,
  success: pc.green,
  error: pc.red,
  warning: pc.yellow,
  muted: pc.gray,
  info: pc.blue,
  bold: pc.bold,
} as const;

const BANNERS = [
  `
   ╭─────────────────────────────╮
   │                             │
   │   🦀  babyclaw  v1.0.0     │
   │                             │
   │   your friendly agent       │
   │   gateway, at your service  │
   │                             │
   ╰─────────────────────────────╯`,
  `
   ╭─────────────────────────────╮
   │                             │
   │   🦞  babyclaw  v1.0.0     │
   │                             │
   │   pincers ready,            │
   │   tasks loaded.             │
   │                             │
   ╰─────────────────────────────╯`,
  `
   ╭─────────────────────────────╮
   │                             │
   │   🦀  babyclaw  v1.0.0     │
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
  "Run 'babyclaw config edit' to tweak your setup interactively.",
  "Use 'babyclaw service status' to check if the gateway is alive.",
  "Add '--json' to most commands for machine-readable output.",
  "The gateway talks over a local Unix socket — no ports to configure.",
  "Use 'babyclaw config validate' after manual edits to catch typos.",
  "Your config lives at ~/.babyclaw/babyclaw.json by default.",
  "You can override the config path with BABYCLAW_CONFIG_PATH.",
];

export function getRandomTip(): string {
  const index = Math.floor(Math.random() * TIPS.length);
  return TIPS[index]!;
}
