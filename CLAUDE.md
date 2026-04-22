# Jellyroll Designer

Battery cell jellyroll winding simulator and production management system.

## First thing every session

Read `SYSTEM.md` in the repo root before doing any work. It contains all infrastructure details, credentials, deploy commands, database architecture, and operational procedures. It is gitignored and local-only.

Whenever you make changes that affect system architecture, infrastructure, deploy procedures, database schema, new API routes, environment variables, or file structure — update `SYSTEM.md` to reflect those changes before finishing the task.

## Key rules

- VM commands: Claude has no SSH access. Write commands for the user to paste into the DigitalOcean web console. Never include inline `#` comments in commands meant for the user to execute.
- Cache-busting: after any JS change, bump the letter suffix on all 13 script tags in `index.html` (e.g. `?v=20260416i` → `?v=20260416j`).
- DB changes: prefer Redash SQL for production schema changes (user runs them manually). Update `models.py` + `schemas.py` to match.
- Commits: do not commit unless explicitly asked.
