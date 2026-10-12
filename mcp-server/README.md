# listmonk MCP server

An [MCP](https://modelcontextprotocol.io) server that exposes listmonk to AI assistants
(Claude Code, Claude Desktop, Cursor, etc.) through the listmonk REST API.

It covers the day-to-day newsletter workflow with dedicated tools and ships a raw
passthrough tool so any other listmonk endpoint stays reachable.

## Tools

| Area | Tools |
| :--- | :--- |
| Subscribers | `list_subscribers`, `get_subscriber`, `create_subscriber`, `update_subscriber`, `delete_subscribers`, `blocklist_subscribers`, `manage_subscriber_lists`, `send_optin_confirmation`, `get_subscriber_bounces` |
| Lists | `list_lists`, `get_list`, `create_list`, `update_list`, `delete_list` |
| Campaigns | `list_campaigns`, `get_campaign`, `create_campaign`, `update_campaign`, `schedule_campaign`, `unschedule_campaign`, `start_campaign`, `set_campaign_status`, `test_campaign`, `preview_campaign`, `delete_campaign`, `get_campaign_stats`, `get_campaign_analytics` |
| Templates & media | `list_templates`, `get_template`, `create_template`, `list_media` |
| Transactional | `send_transactional` |
| Instance | `get_dashboard`, `get_instance_info` |
| Anything else | `listmonk_api_request` (any `/api/...` endpoint, any method) |

### Typical flow

1. `list_lists` to find the target list IDs.
2. `create_campaign` with `name`, `subject`, `lists`, `body` (and optionally `send_at`).
3. `test_campaign` to send a test to yourself.
4. `schedule_campaign` with `send_at` to let listmonk send at that time, or `start_campaign` to send now.

`schedule_campaign` sets `send_at` and moves the campaign to `scheduled` in one step.
Timestamps are ISO 8601 and may include a timezone offset, e.g. `2026-10-20T09:00:00+07:00`.

## Setup

### 1. Create an API user in listmonk

Admin → Users → New → type **API**. Give it a role with the permissions you need
(`subscribers:*`, `lists:*`, `campaigns:*`, `templates:get`, `tx:send`, ...). Copy the token.

### 2. Build

```sh
cd mcp-server
npm install
npm run build
```

### 3. Configure your MCP client

Environment variables:

| Variable | Required | Description |
| :--- | :--- | :--- |
| `LISTMONK_URL` | yes | Base URL, e.g. `https://news.example.com` |
| `LISTMONK_API_USER` | yes | API user name |
| `LISTMONK_API_TOKEN` | yes | API token |
| `LISTMONK_TIMEOUT_MS` | no | Request timeout, default `30000` |

**Claude Code** (project `.mcp.json`, already included at the repo root; export the env vars in your shell):

```json
{
  "mcpServers": {
    "listmonk": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"],
      "env": {
        "LISTMONK_URL": "${LISTMONK_URL}",
        "LISTMONK_API_USER": "${LISTMONK_API_USER}",
        "LISTMONK_API_TOKEN": "${LISTMONK_API_TOKEN}"
      }
    }
  }
}
```

Or register it globally:

```sh
claude mcp add listmonk -s user \
  -e LISTMONK_URL=https://news.example.com \
  -e LISTMONK_API_USER=api_user \
  -e LISTMONK_API_TOKEN=xxxx \
  -- node /absolute/path/to/listmonk-jet/mcp-server/dist/index.js
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "listmonk": {
      "command": "node",
      "args": ["/absolute/path/to/listmonk-jet/mcp-server/dist/index.js"],
      "env": {
        "LISTMONK_URL": "https://news.example.com",
        "LISTMONK_API_USER": "api_user",
        "LISTMONK_API_TOKEN": "xxxx"
      }
    }
  }
}
```

## Development

```sh
npm run dev       # run from source with tsx
npm run typecheck
npm run smoke     # build + end-to-end test against a mock listmonk API
```

The server speaks MCP over stdio. Logs go to stderr.

## Notes

- listmonk's `PUT /api/campaigns/:id` requires the full campaign payload. `update_campaign`,
  `schedule_campaign` and `test_campaign` fetch the current campaign first and merge your changes,
  so you only pass the fields you want to change.
- `send_at` must be in the future; the server rejects past dates before calling listmonk.
- Allowed status transitions mirror listmonk: draft/paused → scheduled or running,
  running → paused, running/paused → cancelled, scheduled → draft.
- Delete and blocklist operations are irreversible.
