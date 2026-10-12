#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { clientFromEnv } from "./client.js";
import { registerTools } from "./tools.js";

async function main() {
  const client = clientFromEnv();

  const server = new McpServer(
    { name: "listmonk", version: "0.1.0" },
    {
      instructions:
        "Tools for managing a listmonk newsletter instance: subscribers, mailing lists, campaigns " +
        "(create, schedule, start, pause, test), templates and transactional email. " +
        "Typical flow to send a newsletter: list_lists -> create_campaign (with lists + body) -> " +
        "test_campaign -> schedule_campaign (or start_campaign). " +
        "Use listmonk_api_request for any endpoint without a dedicated tool. " +
        "Deleting or blocklisting is irreversible; confirm with the user first.",
    },
  );

  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only: stdout is the MCP channel.
  console.error(`listmonk-mcp connected (${process.env.LISTMONK_URL})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
