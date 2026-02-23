# @babyclaw/gateway

## 0.2.1

### Patch Changes

- 00cdf22: Fix skill enable list to show skills with install specs even when dependencies are missing, displaying a "(requires setup)" hint instead of hiding them entirely.

## 0.2.0

### Minor Changes

- 2526e0c: Add bundled skills support

  Skills can now be shipped with the package and enabled/disabled from the CLI without copying files into the workspace. The first bundled skill is `browser-use`.

  - **`@babyclaw/skills`**: New package providing bundled skill file reading utilities with path traversal protection
  - **`@babyclaw/gateway`**: Integrate bundled skills into agent context with workspace-skill deduplication, add read-only guards for `bundled-skills/` prefix on all workspace tools, add `/reload-skills` admin endpoint for live config updates, cache `binaryExists` results, and extract shared `getSkillKey` utility
  - **`babyclaw`**: Add `skill bundled`, `skill enable`, and `skill disable` CLI commands with interactive skill selection and automatic gateway reload

### Patch Changes

- Updated dependencies [2526e0c]
  - @babyclaw/skills@0.1.0

## 0.0.1

### Patch Changes

- 14255fa: Fix systemd service failing to start on Ubuntu. The generated unit file now includes WorkingDirectory, PATH/HOME/NODE_ENV environment variables, and log file redirection. The install command creates the log directory and attempts to enable loginctl linger for headless servers. Also fixes gateway entry path resolution to work with published npm packages via import.meta.resolve.
