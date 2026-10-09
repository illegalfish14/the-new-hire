# Notion setup

The agent adapts to whatever columns your databases have: it reads each database's schema before writing. These layouts are a sensible starting point. Every database is optional; leave its `NOTION_*_DB` variable unset and the agent won't know it exists.

1. Create an internal integration at <https://www.notion.so/my-integrations> and copy the token into `NOTION_TOKEN`.
2. Create the databases below, then use **⋯ → Connections** on each one to add your integration.
3. Copy each database ID (the 32-character string in its URL) into `.env`.

| Database | Env var | Suggested properties |
|---|---|---|
| Content insights | `NOTION_CONTENT_INSIGHTS_DB` | Week (title) · Top Posts (text) · Bottom Posts (text) · What Worked (text) · Recommendations (text) · Created (date) |
| Weekly updates | `NOTION_WEEKLY_UPDATES_DB` | Week (title) · New (text) · Fixed (text) · Status (select: Ready, Used) |
| Content briefs | `NOTION_CONTENT_BRIEFS_DB` | Title (title) · Category (select) · Angle (text) · Outline (text) · Status (select: Brief Ready, In Progress, Ready to Publish, Published) |
| Social drafts | `NOTION_SOCIAL_DRAFTS_DB` | Week (title) · one text property per platform (e.g. Instagram Draft, LinkedIn Draft) · Source (select) · Status (select: Draft Ready, Posted) |
| Pipeline | `NOTION_PIPELINE_DB` | Name (title) · Contact (text) · Email (email) · Status (select: New, Contacted, Follow Up, Replied, Won, Lost) · Last Contact (date) · Notes (text) |
| Channel memory | `NOTION_CHANNEL_MEMORY_DB` | Channel (title) · Date (date) · Day (select) · Summary (text) |

The pipeline agent's follow-up reminders and stats expect `Status` and `Last Contact`. Channel memory expects exactly `Channel`, `Date`, `Day` and `Summary`. Everything else is free-form.

Describe each database in `config/org.json` under `databases`. The description is what the agent reads to understand what the database is for and which status values exist.
