"""Local MCP server for the Bellhaven review queue.

Claude (Claude Code or Claude Desktop) works the queue through the review app's own JSON API
(web/app/api/**/route.ts), so every write runs through the same executor as the UI: atomic claim, live
precondition re-check, CHOW/duplicate sequencing, and an audit trail stamped "via mcp".

Run it with `python -m mcp_server` (stdio). Configured from the environment:
  REVIEW_APP_URL   review app base URL (default http://localhost:3210)
  REVIEWER         who is deciding, e.g. "Ryan Miller (via Claude MCP)"; write tools refuse without it
  REVIEW_PASSCODE  only needed when the review app has a passcode configured
"""
