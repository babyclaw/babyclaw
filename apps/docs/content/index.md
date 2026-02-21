---
seo:
  title: BabyClaw
  description: A simpler personal AI assistant. Self-hosted gateway for Telegram, built on the Vercel AI SDK.
---

::u-page-hero{class="dark:bg-gradient-to-b from-neutral-900 to-neutral-950"}
---
orientation: horizontal
---
#top
:hero-background

#title
A simpler [personal AI assistant]{.text-primary}.

#description
BabyClaw is a self-hosted gateway that connects your Telegram to an AI agent. It can run shell commands, search the web, manage files, keep a schedule, and remember things between conversations. Same lobster spirit as [OpenClaw](https://github.com/openclaw/openclaw), ~5% of the complexity.

#links
  :::u-button
  ---
  to: /getting-started/introduction
  size: xl
  trailing-icon: i-lucide-arrow-right
  ---
  Get started
  :::

  :::u-button
  ---
  icon: i-simple-icons-github
  color: neutral
  variant: outline
  size: xl
  to: https://github.com/babyclaw/babyclaw
  target: _blank
  ---
  View on GitHub
  :::

#default
  :::prose-pre
  ---
  code: |
    {
      "version": 1,
      "channels": {
        "telegram": {
          "botToken": "123456:ABC..."
        }
      },
      "ai": {
        "providers": {
          "anthropic": { "apiKey": "sk-ant-..." }
        },
        "models": {
          "chat": "anthropic:claude-sonnet-4-20250514",
          "browser": "anthropic:claude-sonnet-4-20250514"
        }
      }
    }
  filename: config.json
  ---

  ```json [config.json]
  {
    "version": 1,
    "channels": {
      "telegram": {
        "botToken": "123456:ABC..."
      }
    },
    "ai": {
      "providers": {
        "anthropic": { "apiKey": "sk-ant-..." }
      },
      "models": {
        "chat": "anthropic:claude-sonnet-4-20250514",
        "browser": "anthropic:claude-sonnet-4-20250514"
      }
    }
  }
  ```
  :::
::

::u-page-section{class="dark:bg-neutral-950"}
#title
What's in the box

#links
  :::u-button
  ---
  color: neutral
  size: lg
  to: /getting-started/introduction
  trailingIcon: i-lucide-arrow-right
  variant: subtle
  ---
  Read the introduction
  :::

#features
  :::u-page-feature
  ---
  icon: i-lucide-message-circle
  ---
  #title
  Telegram

  #description
  Chat with your agent from your phone or desktop. Streaming replies, photos, file sharing, and slash commands.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-terminal
  ---
  #title
  Agent Tools

  #description
  The agent can read and write files, run shell commands, search the web, and send messages across linked chats.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-clock
  ---
  #title
  Scheduling

  #description
  One-off and recurring tasks with cron expressions. Ask the agent to remind you or run something on a schedule.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-brain
  ---
  #title
  Memory

  #description
  Automatic daily memory extraction from conversations. The agent builds and maintains its own long-term memory files.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-puzzle
  ---
  #title
  Skills

  #description
  Extend the agent with skills from ClawHub or write your own. Same skill format as OpenClaw -- fully compatible.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-heart-pulse
  ---
  #title
  Heartbeat

  #description
  Periodic check-ins so the agent can be proactive. Check email, review your calendar, monitor things -- and only alert you when it matters.
  :::
::

::u-page-section{class="dark:bg-neutral-950"}
#title
Built with

#features
  :::u-page-feature
  ---
  icon: i-simple-icons-typescript
  ---
  #title
  Vercel AI SDK

  #description
  Agent loop with streaming tool calls and multi-provider support. Anthropic, OpenAI, Google, Mistral, xAI, and OpenRouter.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-database
  ---
  #title
  SQLite + Drizzle

  #description
  Sessions, messages, schedules, and heartbeats in a single SQLite file. No external database to manage.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-bot
  ---
  #title
  grammY

  #description
  Telegram bot framework. Text, photos, streaming replies, inline approval buttons, and slash commands.
  :::
::

::u-page-section{class="dark:bg-gradient-to-b from-neutral-950 to-neutral-900"}
  :::u-page-c-t-a
  ---
  links:
    - label: Get started
      to: '/getting-started/introduction'
      trailingIcon: i-lucide-arrow-right
    - label: Configuration
      to: '/configuration/overview'
      variant: subtle
      icon: i-lucide-settings
  title: Ready to set it up?
  description: You'll need Node 20+, a Telegram bot token, and an AI provider API key. The whole setup takes about five minutes.
  class: dark:bg-neutral-950
  ---

  :stars-bg
  :::
::
