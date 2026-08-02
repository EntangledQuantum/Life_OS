# Life OS HTTP API

Base URL: `http://127.0.0.1:8787`

Auth: `Authorization: Bearer <session-or-API_TOKEN>` on all `/api/v1/*` except login.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/v1/auth/login` | `{ username, password }` → token |
| POST | `/api/v1/auth/logout` | Invalidate session |
| GET | `/api/v1/auth/me` | Current user |
| GET | `/api/v1/habits` | List habits |
| POST | `/api/v1/habits` | Create habit |
| PATCH | `/api/v1/habits/:id` | Update |
| DELETE | `/api/v1/habits/:id` | Soft delete |
| POST | `/api/v1/habits/:id/complete` | Complete today |
| POST | `/api/v1/habits/:id/undo` | Undo today’s completion |
| PATCH | `/api/v1/habits/:id/theme` | Theme |
| GET/POST | `/api/v1/study` | List / log study |
| GET/POST | `/api/v1/goals` | List / create goals |
| PATCH/DELETE | `/api/v1/goals/:id` | Update / delete |
| GET | `/api/v1/dashboard/today` | Full dashboard |
| GET | `/api/v1/dashboard/vs-yesterday` | Deltas |
| GET | `/api/v1/dashboard/pulse` | Pulse |
| GET | `/api/v1/analytics` | Analytics payload |
| GET/POST/DELETE | `/api/v1/session/active` | Right Now timer |
| GET/POST | `/api/v1/quests` | Quests |
| GET/POST | `/api/v1/reviews` | Light reviews |
| GET/POST | `/api/v1/achievements` | Achievements |
| GET/PATCH | `/api/v1/settings` | Settings |
| GET/PATCH | `/api/v1/gamification/config` | XP rules |
| GET | `/api/v1/export/json` | Full export |
| GET | `/api/v1/agent/capabilities` | Capability list |
