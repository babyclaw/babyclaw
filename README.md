# 🦐 BabyClaw

A simpler personal AI assistant. Same lobster spirit, ~5% of the complexity.

---

**BabyClaw** is a stripped-down, opinionated alternative to [OpenClaw](https://github.com/openclaw/openclaw). OpenClaw is incredible — but it's also a beast. Dozens of channels, companion apps, voice wake, canvas, sandboxing… it moves fast and the surface area is massive. BabyClaw exists because sometimes you just want a personal AI assistant that you can actually understand end-to-end, hack on, and keep running without chasing upstream changes.

Same workspace concept. Same skill ecosystem (ClawHub compatible). Just fewer moving parts.

## What's in the box

- **Agent loop** built on [Vercel AI SDK](https://sdk.vercel.ai/) — streaming tool calls, multi-provider support, no custom inference plumbing
- **SQLite database** managed with [Drizzle](https://orm.drizzle.team/) — sessions, messages, schedules, heartbeats, all in one file
- **Telegram channel** via [grammY](https://grammy.dev/) — text, photos, streaming replies, command approval buttons
- **Scheduler** — one-off and recurring cron tasks with timezone support and overlap prevention
- **Heartbeat system** — periodic proactive check-ins with configurable active hours
- **Memory extraction** — automatic daily memory files + curated long-term `MEMORY.md`
- **Workspace & skills** — personality files, agent instructions, and the full [ClawHub](https://clawhub.ai) skill ecosystem
- **Shell tool** with allowlist/approval modes — the agent can run commands, safely
- **Web search** via Brave Search API
- **Cross-chat messaging** — link chats with aliases, send messages between them
- **CLI** with interactive setup wizard, service management, and diagnostics

## Architecture

```
Telegram (more channels coming)
        │
        ▼
┌─────────────────────────┐
│       Gateway           │
│    (control plane)      │
│                         │
│  ┌───────────────────┐  │
│  │  Agent Loop       │  │
│  │  (Vercel AI SDK)  │  │
│  └───────────────────┘  │
│  ┌───────────────────┐  │
│  │  SQLite (Drizzle) │  │
│  └───────────────────┘  │
│  ┌───────────────────┐  │
│  │  Scheduler/Cron   │  │
│  └───────────────────┘  │
│  ┌───────────────────┐  │
│  │  Heartbeat        │  │
│  └───────────────────┘  │
│  ┌───────────────────┐  │
│  │  Memory System    │  │
│  └───────────────────┘  │
│  ┌───────────────────┐  │
│  │  Skills/ClawHub   │  │
│  └───────────────────┘  │
└─────────────────────────┘
        │
        ▼
  Anthropic / OpenAI / Google /
  Mistral / xAI / OpenRouter
```

## Quick start

**Runtime:** Node >= 20

```bash
git clone https://github.com/babyclaw/babyclaw.git
cd babyclaw
pnpm install
pnpm build
```

Run the setup wizard:

```bash
pnpm babyclaw config init
pnpm babyclaw model configure
```

Or create `~/.babyclaw/babyclaw.json` manually:

```jsonc
{
  "version": 1,
  "channels": {
    "telegram": {
      "botToken": "123456:ABC-DEF...",
    },
  },
  "ai": {
    "providers": {
      "anthropic": { "apiKey": "sk-ant-..." },
    },
    "models": {
      "chat": "anthropic/claude-sonnet-4-20250514",
    },
    "aliases": {},
  },
}
```

Start the gateway:

```bash
pnpm babyclaw service start
# or run directly:
node packages/gateway/dist/main.js
```

Run diagnostics:

```bash
pnpm babyclaw doctor
```

## CLI commands

| Command                               | Description                                 |
| ------------------------------------- | ------------------------------------------- |
| `babyclaw config init`                | Create a fresh config file                  |
| `babyclaw config validate`            | Validate current config                     |
| `babyclaw config edit`                | Open config in your editor                  |
| `babyclaw model configure`            | Interactive provider setup                  |
| `babyclaw model`                      | Show current model config                   |
| `babyclaw model alias`                | List / set / remove model aliases           |
| `babyclaw service install`            | Install as system service (launchd/systemd) |
| `babyclaw service start/stop/restart` | Manage the service                          |
| `babyclaw gateway status`             | Query running gateway                       |
| `babyclaw gateway reload`             | Signal config reload                        |
| `babyclaw skill install`              | Install a skill from ClawHub                |
| `babyclaw doctor`                     | Run setup diagnostics                       |

## AI providers

BabyClaw supports multiple providers out of the box via the Vercel AI SDK:

- **Anthropic** (Claude) — recommended
- **OpenAI** (GPT, o-series)
- **Google** (Gemini)
- **Mistral**
- **xAI** (Grok)
- **OpenRouter** (any model behind their API)

Configure separate models for `chat` and optionally `vision` tasks.

## Skills & ClawHub

BabyClaw uses the same skill format as OpenClaw — a `SKILL.md` file with frontmatter metadata in `workspace/skills/<slug>/`. Skills can declare OS requirements, binary dependencies, environment variables, and config needs. The agent discovers eligible skills automatically and reads them when relevant.

Install from [ClawHub](https://clawhub.ai):

```bash
babyclaw skill install <skill-name>
```

Or let the agent install skills itself using the `clawhub_install` tool during a conversation.

## Workspace

The workspace (default: `~/.config/babyclaw/workspace/`) holds the agent's personality and memory:

| File                     | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| `IDENTITY.md`            | Name, creature type, vibe, emoji                  |
| `SOUL.md`                | Personality and behavioral guidelines             |
| `USER.md`                | Who the agent is helping                          |
| `AGENTS.md`              | Workspace rules and conventions                   |
| `TOOLS.md`               | Tool-specific notes (SSH hosts, API quirks, etc.) |
| `HEARTBEAT.md`           | Checklist for proactive heartbeat checks          |
| `MEMORY.md`              | Curated long-term memory                          |
| `memory/YYYY-MM-DD.md`   | Daily memory files                                |
| `skills/<slug>/SKILL.md` | Installed skills                                  |

On first run, the agent bootstraps itself via `BOOTSTRAP.md` — picking a name, filling out its identity, and deleting the bootstrap file.

## Agent tools

The agent has access to these tools during conversations:

- **Workspace** — read, write, list, move, delete files
- **Shell** — execute commands (with allowlist or per-command approval)
- **Scheduler** — create/list/cancel one-off and cron tasks
- **Web search** — Brave Search API
- **ClawHub** — install skills from the registry
- **Messaging** — send messages to linked chats
- **Media** — send files to channels
- **Working memory** — session-scoped scratchpad
- **Self** — gateway status, restart, log access

## Channels

Channel support is abstracted behind a `ChannelAdapter` interface. Currently implemented:

- **Telegram** — full support (text, photos, streaming replies, approval callbacks, `/link` and `/unlink` commands)

Adding a new channel means implementing the adapter interface and registering it with the channel router.

## BabyClaw vs OpenClaw

|                    | BabyClaw              | OpenClaw                        |
| ------------------ | --------------------- | ------------------------------- |
| **Codebase**       | ~5% of OpenClaw's LoC | 84% TypeScript + Swift + Kotlin |
| **Agent loop**     | Vercel AI SDK         | Custom Pi agent runtime         |
| **Database**       | SQLite (Drizzle)      | In-memory + file-based          |
| **Channels**       | Telegram (extensible) | 13+ channels                    |
| **Companion apps** | None                  | macOS, iOS, Android             |
| **Voice**          | No                    | Wake word + Talk Mode           |
| **Canvas**         | No                    | A2UI visual workspace           |
| **Sandboxing**     | No                    | Docker per-session              |
| **Skills**         | ClawHub compatible    | ClawHub compatible              |
| **Workspace**      | Same concept          | Same concept                    |

BabyClaw is not a fork — it's a reimplementation of the parts that matter most for a single-user personal assistant, built to be small enough to fit in your head.

## Monorepo structure

```
babyclaw/
├── packages/
│   ├── gateway/      # Core daemon — agent, channels, tools, scheduler, DB
│   └── cli/          # CLI tool
├── apps/
│   └── docs/         # Documentation site (Nuxt)
└── docs/             # Schema and reference docs
```

## Development

```bash
pnpm install
pnpm build

# Run tests
pnpm test

# Type-check
pnpm typecheck
```

## License

ISC
