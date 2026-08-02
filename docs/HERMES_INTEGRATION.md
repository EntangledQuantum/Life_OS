# Hermes / Agent Integration

Life OS never writes to Obsidian. Hermes (or any agent) reads Life OS and decides what is **special**.

## End-of-day cron pattern (~23:30–01:00 local)

1. `lifeos_get_today` / `GET /api/v1/dashboard/today`
2. Note `vsYesterday` and `pulse`
3. Scan `studySessions` for `inspired` | `feynman` | emotional notes
4. Also check `special_event_candidates` via export or future endpoint
5. Escalate **only** special items into Obsidian (`state/days/YYYY-MM-DD.md`)
6. `lifeos_inject_light_review` / quests for tomorrow
7. Optionally `lifeos_update_xp_rules` or adjust habits/themes based on patterns

## Auth for agents

- Prefer `Authorization: Bearer $API_TOKEN` (from `.env`)
- Or session token from mock login
- MCP uses the same local SQLite file — run on the same machine as the API

## MCP tool list

| Tool | Purpose |
|------|---------|
| `lifeos_list_habits` | Read habits + streaks |
| `lifeos_create_habit` | Create (tiny + anchor encouraged) |
| `lifeos_update_habit` | Patch fields |
| `lifeos_delete_habit` | Soft delete |
| `lifeos_complete_habit` | Log completion as agent |
| `lifeos_set_habit_theme` | emoji / color / graphic |
| `lifeos_get_today` | Dashboard snapshot |
| `lifeos_get_vs_yesterday` | Personal deltas |
| `lifeos_get_pulse` | Improvement pulse |
| `lifeos_log_study` | Study session + quality flag |
| `lifeos_inject_quest` | Daily challenge |
| `lifeos_inject_light_review` | Tomorrow’s light prompt |
| `lifeos_update_xp_rules` | Live gamification config |
| `lifeos_create_achievement` | New badge definition |
| `lifeos_list_achievements` | Unlock state |
| `lifeos_update_settings` | Quiet hours, toggles, theme |
| `lifeos_get_settings` | Read settings |

## Rule

Mundane completions stay in Life OS SQLite. Only exceptional moments go to the Learning Vault.
