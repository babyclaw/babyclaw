# Configuration

Simpleclaw runtime configuration is JSON-only.

## Config file location

- Default: `~/.simpleclaw/simpleclaw.json`
- Override: `SIMPLECLAW_CONFIG_PATH=/absolute/path/to/simpleclaw.json`

## Startup behavior

1. The bot resolves the config path.
2. If the file is missing, it auto-creates a template file.
3. It validates config against a strict schema (`version: 1`).
4. It fails fast if required secrets are placeholders or empty.

Required secrets:

- `telegram.botToken`
- `ai.gatewayApiKey`

If secrets are missing, startup exits with a clear validation error.

## JSON schema

A machine-readable schema is generated at:

- `docs/simpleclaw.schema.json`

Regenerate it with:

```bash
pnpm --filter gateway config:schema
```

## Config shape

```json
{
  "version": 1,
  "telegram": {
    "botToken": "REPLACE_ME"
  },
  "ai": {
    "gatewayApiKey": "REPLACE_ME",
    "baseUrl": "https://ai-gateway.vercel.sh/v1",
    "models": {
      "chat": "anthropic/claude-sonnet-4-20250514",
      "browser": "anthropic/claude-opus-4.6"
    }
  },
  "database": {
    "url": "file:../data/simpleclaw.db"
  },
  "scheduler": {
    "timezone": "UTC"
  },
  "workspace": {
    "root": "."
  },
  "session": {
    "maxMessagesPerSession": 120,
    "historyLimit": 40,
    "replyChainMode": "default"
  },
  "tools": {
    "enableGenericTools": true,
    "enableBrowserTools": false,
    "browser": {
      "headless": true
    },
    "webSearch": {
      "braveApiKey": null
    }
  }
}
```

## Field reference

- `version` (required): Must be `1`.
- `telegram.botToken` (required secret): Telegram bot token.
- `ai.gatewayApiKey` (required secret): AI gateway API key.
- `ai.baseUrl` (optional): Defaults to `https://ai-gateway.vercel.sh/v1`.
- `ai.models.chat` (optional): Default `anthropic/claude-sonnet-4-20250514`.
- `ai.models.browser` (optional): Default `anthropic/claude-opus-4.6`.
- `database.url` (optional): Default `file:../data/simpleclaw.db`.
- `scheduler.timezone` (optional): Valid IANA timezone, default `UTC`.
- `workspace.root` (optional): Workspace root relative to process working directory, default `.`.
- `session.maxMessagesPerSession` (optional): Positive integer, default `120`.
- `session.historyLimit` (optional): Positive integer, default `40`.
- `session.replyChainMode` (optional): `default` or `reply-chain`, default `default`.
- `tools.enableGenericTools` (optional): Default `true`.
- `tools.enableBrowserTools` (optional): Default `false`.
- `tools.browser.headless` (optional): Default `true`.
- `tools.webSearch.braveApiKey` (optional): Brave API key or `null`.

## Secret handling

- Keep the config file outside your repo.
- Recommended permissions:

```bash
chmod 700 ~/.simpleclaw
chmod 600 ~/.simpleclaw/simpleclaw.json
```

## Env-to-JSON migration map

- `BOT_TOKEN` -> `telegram.botToken`
- `AI_GATEWAY_API_KEY` -> `ai.gatewayApiKey`
- `AI_MODEL` -> `ai.models.chat`
- `DATABASE_URL` -> `database.url`
- `BOT_TIMEZONE` -> `scheduler.timezone`
- `WORKSPACE_ROOT` -> `workspace.root`
- `MAX_MESSAGES_PER_SESSION` -> `session.maxMessagesPerSession`
- `HISTORY_LIMIT` -> `session.historyLimit`
- `SESSION_REPLY_CHAIN_MODE` -> `session.replyChainMode`
- `ENABLE_GENERIC_TOOLS` -> `tools.enableGenericTools`
- `ENABLE_BROWSER_TOOLS` -> `tools.enableBrowserTools`
- `BROWSER_USE_HEADLESS` -> `tools.browser.headless`
- `BRAVE_SEARCH_API_KEY` -> `tools.webSearch.braveApiKey`
- hardcoded browser model -> `ai.models.browser`
- hardcoded AI base URL -> `ai.baseUrl`

## Notes

- Runtime no longer loads `.env`.
- `.env.example` is retained as deprecated migration reference.
- Prisma CLI workflow is unchanged and out of scope for runtime config migration.
