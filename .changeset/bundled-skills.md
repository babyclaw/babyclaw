---
"@babyclaw/skills": minor
"@babyclaw/gateway": minor
"babyclaw": minor
---

Add bundled skills support

Skills can now be shipped with the package and enabled/disabled from the CLI without copying files into the workspace. The first bundled skill is `browser-use`.

- **`@babyclaw/skills`**: New package providing bundled skill file reading utilities with path traversal protection
- **`@babyclaw/gateway`**: Integrate bundled skills into agent context with workspace-skill deduplication, add read-only guards for `bundled-skills/` prefix on all workspace tools, add `/reload-skills` admin endpoint for live config updates, cache `binaryExists` results, and extract shared `getSkillKey` utility
- **`babyclaw`**: Add `skill bundled`, `skill enable`, and `skill disable` CLI commands with interactive skill selection and automatic gateway reload
