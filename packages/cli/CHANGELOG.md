# babyclaw

## 0.1.0

### Minor Changes

- 23dfdd3: Add `babyclaw update` command for self-updating via npm. Automatically regenerates the service file and restarts the gateway if running.

## 0.0.1

### Patch Changes

- 14255fa: Fix systemd service failing to start on Ubuntu. The generated unit file now includes WorkingDirectory, PATH/HOME/NODE_ENV environment variables, and log file redirection. The install command creates the log directory and attempts to enable loginctl linger for headless servers. Also fixes gateway entry path resolution to work with published npm packages via import.meta.resolve.
- Updated dependencies [14255fa]
  - @babyclaw/gateway@0.0.1
