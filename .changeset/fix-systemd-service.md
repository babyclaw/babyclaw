---
"babyclaw": patch
"@babyclaw/gateway": patch
---

Fix systemd service failing to start on Ubuntu. The generated unit file now includes WorkingDirectory, PATH/HOME/NODE_ENV environment variables, and log file redirection. The install command creates the log directory and attempts to enable loginctl linger for headless servers. Also fixes gateway entry path resolution to work with published npm packages via import.meta.resolve.
