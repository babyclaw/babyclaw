---
"@babyclaw/gateway": patch
"babyclaw": patch
---

fix: augment PATH with well-known tool binary directories

Tool binaries installed by skill setup (e.g. `uv tool install browser-use`) are placed in directories like `~/.local/bin` that are often not in PATH when the gateway runs as a systemd/launchd service. This adds centralized PATH discovery at gateway startup that probes for uv, npm, go, and Homebrew binary directories, ensuring installed tools are always findable.
