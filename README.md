<a href="https://zerodha.tech"><img src="https://zerodha.tech/static/images/github-badge.svg" align="right" /></a>

[![listmonk-logo](https://user-images.githubusercontent.com/547147/231084896-835dba66-2dfe-497c-ba0f-787564c0819e.png)](https://listmonk.app)

listmonk is a standalone, self-hosted, newsletter and mailing list manager. It is fast, feature-rich, and packed into a single binary. It uses a PostgreSQL database as its data store.

[![listmonk-dashboard](https://github.com/user-attachments/assets/689b5fbb-dd25-4956-a36f-e3226a65f9c4)](https://listmonk.app)

Visit [listmonk.app](https://listmonk.app) for more info. Check out the [**live demo**](https://demo.listmonk.app).

## Installation

### Docker

The latest image is available on DockerHub at [`listmonk/listmonk:latest`](https://hub.docker.com/r/listmonk/listmonk/tags?page=1&ordering=last_updated&name=latest).
Download and use the sample [docker-compose.yml](https://github.com/knadh/listmonk/blob/master/docker-compose.yml).


```shell
# Download the compose file to the current directory.
curl -LO https://github.com/knadh/listmonk/raw/master/docker-compose.yml

# Run the services in the background.
docker compose up -d
```
Visit `http://localhost:9000`

See [installation docs](https://listmonk.app/docs/installation)

__________________

### Binary
- Download the [latest release](https://github.com/knadh/listmonk/releases) and extract the listmonk binary.
- `./listmonk --new-config` to generate config.toml. Edit it.
- `./listmonk --install` to setup the Postgres DB (or `--upgrade` to upgrade an existing DB. Upgrades are idempotent and running them multiple times have no side effects).
- Run `./listmonk` and visit `http://localhost:9000`

See [installation docs](https://listmonk.app/docs/installation)
__________________


## MCP server (AI assistant integration)

This fork ships an [MCP](https://modelcontextprotocol.io) server in [`mcp-server/`](mcp-server/) that lets AI assistants such as Claude Code, Claude Desktop or Cursor operate listmonk through its REST API.

Available tools cover:

- **Subscribers**: list/search (by list, subscription status, free text or SQL query), get, create, update, delete, blocklist, add/remove from lists, send opt-in confirmation, bounces.
- **Lists**: list, get, create, update, delete.
- **Campaigns**: list, get, create (pick target lists, set `send_at`), update, schedule/unschedule, start, pause/cancel, send test, preview, delete, live stats and analytics.
- **Templates & media**: list/get/create templates, list media.
- **Transactional email**: send via a tx template.
- **Anything else**: `listmonk_api_request` calls any `/api/...` endpoint, so every listmonk feature stays reachable.

Quick start:

```shell
cd mcp-server
npm install && npm run build

# Create an API user in listmonk (Admin -> Users -> type "API"), then:
export LISTMONK_URL=https://news.example.com
export LISTMONK_API_USER=api_user
export LISTMONK_API_TOKEN=xxxx
```

The repo root contains a [`.mcp.json`](.mcp.json) that Claude Code picks up automatically using those environment variables. See [mcp-server/README.md](mcp-server/README.md) for the full tool list, Claude Desktop configuration and development notes.

__________________


## Developers
listmonk is free and open source software licensed under AGPLv3. If you are interested in contributing, refer to the [developer setup](https://listmonk.app/docs/developer-setup). The backend is written in Go and the frontend is Vue with Buefy for UI. 


## License
listmonk is licensed under the AGPL v3 license.
