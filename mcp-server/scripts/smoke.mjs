// Smoke test: boots a fake listmonk API, connects to the MCP server over stdio,
// and checks that the important tools issue the right HTTP calls.
// Run: npm run smoke
import http from "node:http";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const calls = [];
const campaigns = new Map();
let nextId = 1;
const env = (data) => JSON.stringify({ data });

const mock = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : undefined;
  const url = new URL(req.url, "http://x");
  calls.push({ method: req.method, path: url.pathname, query: url.search, body, auth: req.headers.authorization });
  res.setHeader("content-type", "application/json");
  const send = (code, payload) => { res.statusCode = code; res.end(payload); };

  if (req.method === "GET" && url.pathname === "/api/lists") {
    return send(200, env({ results: [{ id: 1, name: "Default list", subscriber_count: 3 }], total: 1, page: 1, per_page: 20 }));
  }
  if (req.method === "GET" && url.pathname === "/api/lists/1") {
    return send(200, env({ id: 1, name: "Default list", type: "private", optin: "single", status: "active", tags: ["a"] }));
  }
  if (req.method === "PUT" && url.pathname === "/api/lists/1") return send(200, env({ id: 1, ...body }));
  if (req.method === "GET" && url.pathname === "/api/subscribers") {
    return send(200, env({ results: [{ id: 1, email: "a@b.c", name: "A" }], total: 1 }));
  }
  if (req.method === "POST" && url.pathname === "/api/campaigns") {
    const c = { id: nextId++, status: "draft", ...body, lists: body.lists.map((id) => ({ id, name: `L${id}` })), media: [] };
    campaigns.set(c.id, c);
    return send(200, env(c));
  }
  const m = url.pathname.match(/^\/api\/campaigns\/(\d+)(\/status)?$/);
  if (m) {
    const c = campaigns.get(Number(m[1]));
    if (!c) return send(404, JSON.stringify({ message: "Campaign not found" }));
    if (req.method === "GET") return send(200, env(c));
    if (req.method === "PUT" && !m[2]) {
      if (!body.name || !body.subject || !body.lists?.length) return send(400, JSON.stringify({ message: "invalid fields" }));
      Object.assign(c, body, { lists: body.lists.map((id) => ({ id })) });
      return send(200, env(c));
    }
    if (req.method === "PUT" && m[2]) {
      if (body.status === "scheduled" && !c.send_at) return send(400, JSON.stringify({ message: "needs send_at" }));
      c.status = body.status;
      return send(200, env(c));
    }
  }
  send(404, JSON.stringify({ message: `no route ${req.method} ${url.pathname}` }));
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${mock.address().port}`;

const t = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, LISTMONK_URL: base, LISTMONK_API_USER: "api", LISTMONK_API_TOKEN: "secret" },
  stderr: "pipe",
});
const c = new Client({ name: "smoke", version: "0" });
await c.connect(t);
const text = (r) => r.content[0].text;
const json = (r) => JSON.parse(text(r).replace(/^[^\n{[]*\n\n/, ""));

const { tools } = await c.listTools();
console.log(`${tools.length} tools registered`);
assert.ok(tools.length >= 30);

// auth header + list_lists
let r = await c.callTool({ name: "list_lists", arguments: { per_page: 5, status: "active" } });
assert.equal(r.isError, undefined);
assert.equal(calls.at(-1).auth, "token api:secret");
assert.equal(calls.at(-1).query, "?per_page=5&status=active");
assert.equal(json(r).results[0].name, "Default list");
console.log("ok  list_lists");

// list_subscribers with repeated list_id
r = await c.callTool({ name: "list_subscribers", arguments: { list_id: [1, 2], subscription_status: "confirmed" } });
assert.equal(calls.at(-1).query, "?list_id=1&list_id=2&subscription_status=confirmed");
console.log("ok  list_subscribers");

// create_campaign draft
const future = new Date(Date.now() + 86_400_000).toISOString();
r = await c.callTool({ name: "create_campaign", arguments: { name: "N", subject: "S", lists: [1], body: "<p>hi</p>" } });
assert.equal(r.isError, undefined);
assert.deepEqual(calls.at(-1).body.lists, [1]);
assert.equal(calls.at(-1).body.content_type, "richtext");
assert.equal(json(r).status, "draft");
const draftId = json(r).id;
console.log("ok  create_campaign (draft)");

// create_campaign + schedule=true -> POST then PUT status
r = await c.callTool({ name: "create_campaign", arguments: { name: "N2", subject: "S", lists: [1], body: "x", send_at: future, schedule: true } });
assert.equal(r.isError, undefined, text(r));
assert.equal(calls.at(-2).method, "POST");
assert.equal(calls.at(-1).path.endsWith("/status"), true);
assert.equal(calls.at(-1).body.status, "scheduled");
assert.equal(json(r).status, "scheduled");
console.log("ok  create_campaign (schedule=true)");

// schedule_campaign on draft: GET -> PUT (full body merged) -> PUT status
const before = calls.length;
r = await c.callTool({ name: "schedule_campaign", arguments: { id: draftId, send_at: future } });
assert.equal(r.isError, undefined, text(r));
const seq = calls.slice(before).map((x) => `${x.method} ${x.path}`);
assert.deepEqual(seq, [`GET /api/campaigns/${draftId}`, `PUT /api/campaigns/${draftId}`, `PUT /api/campaigns/${draftId}/status`]);
assert.equal(calls.at(-2).body.name, "N"); // preserved from GET
assert.equal(json(r).status, "scheduled");
console.log("ok  schedule_campaign");

// past send_at rejected locally
r = await c.callTool({ name: "schedule_campaign", arguments: { id: draftId, send_at: "2020-01-01T00:00:00Z" } });
assert.equal(r.isError, true);
assert.match(text(r), /in the past/);
console.log("ok  past send_at rejected");

// update_list merges current values
r = await c.callTool({ name: "update_list", arguments: { id: 1, description: "new" } });
assert.equal(calls.at(-1).body.name, "Default list");
assert.equal(calls.at(-1).body.description, "new");
console.log("ok  update_list merge");

// API error surfaced
r = await c.callTool({ name: "get_campaign", arguments: { id: 999 } });
assert.equal(r.isError, true);
assert.match(text(r), /404.*Campaign not found/);
console.log("ok  api error surfaced");

// raw passthrough
r = await c.callTool({ name: "listmonk_api_request", arguments: { method: "GET", path: "/api/lists", query: { tag: ["x", "y"] } } });
assert.equal(calls.at(-1).query, "?tag=x&tag=y");
assert.ok(json(r).data);
console.log("ok  listmonk_api_request");

await c.close();
mock.close();
console.log("\nall smoke checks passed");
