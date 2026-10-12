import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ListmonkClient, Query } from "./client.js";
import { compact, guard, normalizeSendAt, ok } from "./util.js";
import { getCampaign, patchCampaign, setStatus, toWriteBody, type CampaignWrite } from "./campaigns.js";

// ---------- shared schema fragments ----------
const page = z.number().int().min(1).optional().describe("Page number (1-based).");
const perPage = z
  .union([z.number().int().min(1), z.literal("all")])
  .optional()
  .describe("Results per page, or 'all'.");
const order = z.enum(["ASC", "DESC"]).optional().describe("Sort direction.");
const idList = z.array(z.number().int()).min(1);

const CampaignStatus = z.enum(["draft", "scheduled", "running", "paused", "cancelled", "finished"]);
const ContentType = z.enum(["richtext", "html", "markdown", "plain", "visual"]);

const campaignWriteShape = {
  name: z.string().min(1).optional().describe("Campaign name (internal)."),
  subject: z.string().min(1).optional().describe("Email subject. Supports Go templating."),
  lists: z.array(z.number().int()).optional().describe("List IDs the campaign is sent to."),
  from_email: z
    .string()
    .optional()
    .describe("Sender, e.g. 'Name <noreply@example.com>'. Defaults to the instance setting."),
  type: z.enum(["regular", "optin"]).optional().describe("Campaign type. Default 'regular'."),
  content_type: ContentType.optional().describe("Body format. Default 'richtext'."),
  body: z.string().optional().describe("Campaign body (HTML/markdown/plain). Supports {{ .Subscriber.* }} templating."),
  altbody: z.string().optional().describe("Alternate plain-text body for HTML emails."),
  send_at: z
    .string()
    .optional()
    .describe("ISO 8601 timestamp to schedule sending, e.g. 2026-10-20T09:00:00+07:00. Must be in the future."),
  messenger: z.string().optional().describe("'email' (default) or a custom messenger name."),
  template_id: z.number().int().optional().describe("Template ID. Defaults to the default template."),
  tags: z.array(z.string()).optional(),
  headers: z
    .array(z.record(z.string(), z.string()))
    .optional()
    .describe("Extra SMTP headers, e.g. [{\"X-Custom\": \"value\"}]."),
  attribs: z.record(z.string(), z.unknown()).optional().describe("Arbitrary JSON available in templates."),
  media: z.array(z.number().int()).optional().describe("Media (attachment) IDs."),
  archive: z.boolean().optional().describe("Publish to the public archive."),
  archive_template_id: z.number().int().optional(),
  archive_meta: z.record(z.string(), z.unknown()).optional(),
  archive_slug: z.string().optional(),
};

export function registerTools(server: McpServer, client: ListmonkClient) {
  // =====================================================================
  // Subscribers
  // =====================================================================
  server.registerTool(
    "list_subscribers",
    {
      title: "List subscribers",
      description:
        "List/search subscribers. Filter by list, subscription status, free-text search or an SQL expression " +
        "(e.g. \"subscribers.status='enabled' AND attribs->>'city'='Jakarta'\"). Paginated.",
      inputSchema: {
        page,
        per_page: perPage,
        search: z.string().optional().describe("Free-text search on name/email."),
        query: z.string().optional().describe("Advanced SQL WHERE expression (listmonk query syntax)."),
        list_id: z.array(z.number().int()).optional().describe("Only subscribers in these list IDs."),
        subscription_status: z
          .enum(["confirmed", "unconfirmed", "unsubscribed"])
          .optional()
          .describe("Subscription status in the given list_id(s)."),
        status: z.enum(["enabled", "disabled", "blocklisted"]).optional().describe("Subscriber account status."),
        order_by: z.enum(["id", "email", "name", "status", "created_at", "updated_at"]).optional(),
        order,
      },
    },
    guard(async (a) => ok(await client.get("/api/subscribers", a as Query))),
  );

  server.registerTool(
    "get_subscriber",
    {
      title: "Get subscriber",
      description: "Get one subscriber by ID, including list subscriptions and attribs.",
      inputSchema: { id: z.number().int() },
    },
    guard(async ({ id }) => ok(await client.get(`/api/subscribers/${id}`))),
  );

  server.registerTool(
    "create_subscriber",
    {
      title: "Create subscriber",
      description: "Create a subscriber and optionally subscribe them to lists.",
      inputSchema: {
        email: z.string().email(),
        name: z.string().min(1),
        status: z.enum(["enabled", "blocklisted"]).default("enabled"),
        lists: z.array(z.number().int()).optional().describe("List IDs to subscribe to."),
        attribs: z.record(z.string(), z.unknown()).optional(),
        preconfirm_subscriptions: z
          .boolean()
          .optional()
          .describe("Mark subscriptions confirmed and skip double opt-in emails."),
      },
    },
    guard(async (a) => ok(await client.post("/api/subscribers", compact(a)))),
  );

  server.registerTool(
    "update_subscriber",
    {
      title: "Update subscriber",
      description:
        "Partially update a subscriber (PATCH). Only the fields you pass are changed. " +
        "Passing `lists` replaces the subscriber's list memberships.",
      inputSchema: {
        id: z.number().int(),
        email: z.string().email().optional(),
        name: z.string().optional(),
        status: z.enum(["enabled", "blocklisted"]).optional(),
        lists: z.array(z.number().int()).optional(),
        attribs: z.record(z.string(), z.unknown()).optional(),
        preconfirm_subscriptions: z.boolean().optional(),
      },
    },
    guard(async ({ id, ...rest }) => ok(await client.patch(`/api/subscribers/${id}`, compact(rest)))),
  );

  server.registerTool(
    "delete_subscribers",
    {
      title: "Delete subscribers",
      description: "Permanently delete subscribers by ID. Irreversible.",
      inputSchema: { ids: idList },
    },
    guard(async ({ ids }) => {
      await client.delete("/api/subscribers", { id: ids });
      return ok({ deleted: ids });
    }),
  );

  server.registerTool(
    "blocklist_subscribers",
    {
      title: "Blocklist subscribers",
      description: "Blocklist subscribers by ID (they will no longer receive any campaign).",
      inputSchema: { ids: idList },
    },
    guard(async ({ ids }) => ok(await client.put("/api/subscribers/blocklist", { ids }))),
  );

  server.registerTool(
    "manage_subscriber_lists",
    {
      title: "Add/remove subscribers from lists",
      description: "Bulk add, remove or unsubscribe subscribers from lists.",
      inputSchema: {
        ids: idList.describe("Subscriber IDs."),
        action: z.enum(["add", "remove", "unsubscribe"]),
        target_list_ids: idList.describe("List IDs."),
        status: z
          .enum(["confirmed", "unconfirmed", "unsubscribed"])
          .optional()
          .describe("Subscription status to set; required for action 'add'."),
      },
    },
    guard(async (a) => {
      if (a.action === "add" && !a.status) a.status = "confirmed";
      return ok(await client.put("/api/subscribers/lists", compact(a)));
    }),
  );

  server.registerTool(
    "send_optin_confirmation",
    {
      title: "Send opt-in confirmation",
      description: "Send the double opt-in confirmation email to a subscriber for their unconfirmed lists.",
      inputSchema: { id: z.number().int() },
    },
    guard(async ({ id }) => ok(await client.post(`/api/subscribers/${id}/optin`))),
  );

  server.registerTool(
    "get_subscriber_bounces",
    {
      title: "Get subscriber bounces",
      description: "List bounce records for a subscriber.",
      inputSchema: { id: z.number().int() },
    },
    guard(async ({ id }) => ok(await client.get(`/api/subscribers/${id}/bounces`))),
  );

  // =====================================================================
  // Lists
  // =====================================================================
  server.registerTool(
    "list_lists",
    {
      title: "List mailing lists",
      description: "List mailing lists with subscriber counts. Filter by name, status or tag.",
      inputSchema: {
        page,
        per_page: perPage,
        query: z.string().optional().describe("Search by list name."),
        status: z.enum(["active", "archived"]).optional(),
        tag: z.array(z.string()).optional(),
        minimal: z.boolean().optional().describe("Skip subscriber counts for speed."),
        order_by: z.enum(["name", "status", "created_at", "updated_at"]).optional(),
        order,
      },
    },
    guard(async (a) => ok(await client.get("/api/lists", a as Query))),
  );

  server.registerTool(
    "get_list",
    {
      title: "Get list",
      description: "Get one mailing list by ID.",
      inputSchema: { id: z.number().int() },
    },
    guard(async ({ id }) => ok(await client.get(`/api/lists/${id}`))),
  );

  server.registerTool(
    "create_list",
    {
      title: "Create list",
      description: "Create a new mailing list.",
      inputSchema: {
        name: z.string().min(1),
        type: z.enum(["private", "public"]).default("private"),
        optin: z.enum(["single", "double"]).default("single"),
        status: z.enum(["active", "archived"]).optional(),
        tags: z.array(z.string()).optional(),
        description: z.string().optional(),
      },
    },
    guard(async (a) => ok(await client.post("/api/lists", compact(a)))),
  );

  server.registerTool(
    "update_list",
    {
      title: "Update list",
      description: "Update a mailing list. Unspecified fields keep their current value.",
      inputSchema: {
        id: z.number().int(),
        name: z.string().optional(),
        type: z.enum(["private", "public"]).optional(),
        optin: z.enum(["single", "double"]).optional(),
        status: z.enum(["active", "archived"]).optional(),
        tags: z.array(z.string()).optional(),
        description: z.string().optional(),
      },
    },
    guard(async ({ id, ...patch }) => {
      const cur = await client.get<Record<string, unknown>>(`/api/lists/${id}`);
      const body = {
        name: cur.name,
        type: cur.type,
        optin: cur.optin,
        status: cur.status,
        tags: cur.tags ?? [],
        description: cur.description ?? "",
        ...compact(patch),
      };
      return ok(await client.put(`/api/lists/${id}`, body));
    }),
  );

  server.registerTool(
    "delete_list",
    {
      title: "Delete list",
      description: "Delete a mailing list by ID. Irreversible.",
      inputSchema: { id: z.number().int() },
    },
    guard(async ({ id }) => {
      await client.delete(`/api/lists/${id}`);
      return ok({ deleted: id });
    }),
  );

  // =====================================================================
  // Campaigns
  // =====================================================================
  server.registerTool(
    "list_campaigns",
    {
      title: "List campaigns",
      description: "List campaigns with status, lists, send_at and stats. Bodies omitted unless include_body=true.",
      inputSchema: {
        page,
        per_page: perPage,
        query: z.string().optional().describe("Search by name/subject."),
        status: z.array(CampaignStatus).optional(),
        tag: z.array(z.string()).optional(),
        order_by: z.enum(["name", "status", "created_at", "updated_at"]).optional(),
        order,
        include_body: z.boolean().default(false),
      },
    },
    guard(async ({ include_body, ...rest }) =>
      ok(await client.get("/api/campaigns", { ...(rest as Query), no_body: !include_body })),
    ),
  );

  server.registerTool(
    "get_campaign",
    {
      title: "Get campaign",
      description: "Get one campaign by ID including body, lists, schedule and stats.",
      inputSchema: { id: z.number().int(), include_body: z.boolean().default(true) },
    },
    guard(async ({ id, include_body }) => ok(await client.get(`/api/campaigns/${id}`, { no_body: !include_body }))),
  );

  server.registerTool(
    "create_campaign",
    {
      title: "Create campaign",
      description:
        "Create a campaign targeting one or more lists. Created as a draft. " +
        "Pass `send_at` to set a schedule time, and `schedule=true` to immediately move it to 'scheduled' " +
        "so listmonk sends it automatically at send_at. Without schedule=true the campaign stays a draft.",
      inputSchema: {
        ...campaignWriteShape,
        name: z.string().min(1),
        subject: z.string().min(1),
        lists: z.array(z.number().int()).min(1).describe("List IDs to send to (required)."),
        body: z.string().min(1),
        schedule: z
          .boolean()
          .default(false)
          .describe("If true and send_at is set, set status to 'scheduled' right after creation."),
      },
    },
    guard(async ({ schedule, ...a }) => {
      const body: CampaignWrite = compact({
        ...a,
        type: a.type ?? "regular",
        content_type: a.content_type ?? "richtext",
        messenger: a.messenger ?? "email",
        send_at: a.send_at ? normalizeSendAt(a.send_at) : undefined,
      }) as CampaignWrite;
      if (schedule && !body.send_at) throw new Error("schedule=true requires send_at.");

      const created = await client.post<{ id: number }>("/api/campaigns", body);
      if (!schedule) return ok(created, "Campaign created as draft.");
      const scheduled = await setStatus(client, created.id, "scheduled");
      return ok(scheduled, `Campaign created and scheduled for ${body.send_at}.`);
    }),
  );

  server.registerTool(
    "update_campaign",
    {
      title: "Update campaign",
      description:
        "Update a draft/scheduled/paused campaign. Only pass fields to change; others are preserved. " +
        "Running or finished campaigns cannot be edited.",
      inputSchema: { id: z.number().int(), ...campaignWriteShape },
    },
    guard(async ({ id, ...patch }) => {
      const p = compact(patch) as CampaignWrite;
      if (p.send_at) p.send_at = normalizeSendAt(p.send_at);
      return ok(await patchCampaign(client, id, p));
    }),
  );

  server.registerTool(
    "schedule_campaign",
    {
      title: "Schedule campaign",
      description:
        "Schedule a campaign to be sent at a future time. Sets send_at (if given) and changes status to 'scheduled'. " +
        "Works on draft or paused campaigns. If send_at is omitted the campaign's existing send_at is used.",
      inputSchema: {
        id: z.number().int(),
        send_at: z
          .string()
          .optional()
          .describe("ISO 8601 timestamp, e.g. 2026-10-20T09:00:00+07:00. Must be in the future."),
      },
    },
    guard(async ({ id, send_at }) => {
      let sendAt: string | null | undefined;
      if (send_at) {
        const updated = await patchCampaign(client, id, { send_at: normalizeSendAt(send_at) });
        sendAt = updated.send_at;
      } else {
        const current = await getCampaign(client, id);
        if (!current.send_at) throw new Error("Campaign has no send_at. Pass send_at to schedule it.");
        sendAt = current.send_at;
      }
      const out = await setStatus(client, id, "scheduled");
      return ok(out, `Campaign ${id} scheduled for ${out.send_at ?? sendAt}.`);
    }),
  );

  server.registerTool(
    "unschedule_campaign",
    {
      title: "Unschedule campaign",
      description: "Move a 'scheduled' campaign back to 'draft' so it will not be sent.",
      inputSchema: { id: z.number().int() },
    },
    guard(async ({ id }) => ok(await setStatus(client, id, "draft"))),
  );

  server.registerTool(
    "start_campaign",
    {
      title: "Start campaign now",
      description: "Start sending a draft or paused campaign immediately (status -> running).",
      inputSchema: { id: z.number().int() },
    },
    guard(async ({ id }) => ok(await setStatus(client, id, "running"))),
  );

  server.registerTool(
    "set_campaign_status",
    {
      title: "Set campaign status",
      description:
        "Change campaign status. Allowed transitions: draft/paused -> scheduled (needs send_at), " +
        "draft/paused -> running, running -> paused, running/paused -> cancelled, scheduled -> draft.",
      inputSchema: {
        id: z.number().int(),
        status: z.enum(["draft", "scheduled", "running", "paused", "cancelled"]),
      },
    },
    guard(async ({ id, status }) => ok(await setStatus(client, id, status))),
  );

  server.registerTool(
    "test_campaign",
    {
      title: "Send test campaign",
      description:
        "Send the campaign as a test to specific subscriber emails (they must exist as subscribers). " +
        "Uses the campaign's saved content unless overrides are passed.",
      inputSchema: {
        id: z.number().int(),
        subscribers: z.array(z.string().email()).min(1).describe("Subscriber emails to send the test to."),
        ...campaignWriteShape,
      },
    },
    guard(async ({ id, subscribers, ...overrides }) => {
      const cur = await getCampaign(client, id);
      const body = { ...toWriteBody(cur), ...compact(overrides), subscribers };
      return ok(await client.post(`/api/campaigns/${id}/test`, body));
    }),
  );

  server.registerTool(
    "preview_campaign",
    {
      title: "Preview campaign",
      description: "Render the campaign HTML as the first subscriber would see it.",
      inputSchema: { id: z.number().int() },
    },
    guard(async ({ id }) => ok(await client.request<string>("GET", `/api/campaigns/${id}/preview`, { raw: true }))),
  );

  server.registerTool(
    "delete_campaign",
    {
      title: "Delete campaign",
      description: "Delete a campaign by ID. Irreversible.",
      inputSchema: { id: z.number().int() },
    },
    guard(async ({ id }) => {
      await client.delete(`/api/campaigns/${id}`);
      return ok({ deleted: id });
    }),
  );

  server.registerTool(
    "get_campaign_stats",
    {
      title: "Running campaign stats",
      description: "Live sending progress for running campaigns (sent / to_send / rate).",
      inputSchema: { campaign_ids: z.array(z.number().int()).min(1) },
    },
    guard(async ({ campaign_ids }) => ok(await client.get("/api/campaigns/running/stats", { campaign_id: campaign_ids }))),
  );

  server.registerTool(
    "get_campaign_analytics",
    {
      title: "Campaign analytics",
      description: "Views, clicks, bounces or link counts for campaigns over a date range.",
      inputSchema: {
        campaign_ids: z.array(z.number().int()).min(1),
        type: z.enum(["views", "clicks", "bounces", "links"]),
        from: z.string().describe("Start date, e.g. 2026-10-01 or ISO timestamp."),
        to: z.string().describe("End date."),
        interval: z.enum(["hour", "day", "week", "month"]).optional(),
      },
    },
    guard(async ({ campaign_ids, type, ...rest }) =>
      ok(await client.get(`/api/campaigns/analytics/${type}`, { id: campaign_ids, ...rest })),
    ),
  );

  // =====================================================================
  // Templates & media
  // =====================================================================
  server.registerTool(
    "list_templates",
    {
      title: "List templates",
      description: "List campaign and transactional templates (IDs needed for template_id).",
      inputSchema: { include_body: z.boolean().default(false) },
    },
    guard(async ({ include_body }) => ok(await client.get("/api/templates", { no_body: !include_body }))),
  );

  server.registerTool(
    "get_template",
    {
      title: "Get template",
      description: "Get one template by ID including body.",
      inputSchema: { id: z.number().int() },
    },
    guard(async ({ id }) => ok(await client.get(`/api/templates/${id}`))),
  );

  server.registerTool(
    "create_template",
    {
      title: "Create template",
      description: "Create a campaign or transactional (tx) template. Campaign templates must contain {{ template \"content\" . }}.",
      inputSchema: {
        name: z.string().min(1),
        type: z.enum(["campaign", "campaign_visual", "tx"]).default("campaign"),
        subject: z.string().optional().describe("Only for tx templates."),
        body: z.string().min(1),
        body_source: z.string().optional(),
      },
    },
    guard(async (a) => ok(await client.post("/api/templates", compact(a)))),
  );

  server.registerTool(
    "list_media",
    {
      title: "List media",
      description: "List uploaded media files (for campaign attachments / images).",
      inputSchema: { page, per_page: perPage, query: z.string().optional() },
    },
    guard(async (a) => ok(await client.get("/api/media", a as Query))),
  );

  // =====================================================================
  // Transactional
  // =====================================================================
  server.registerTool(
    "send_transactional",
    {
      title: "Send transactional email",
      description: "Send a transactional message using a tx template to one or more recipients.",
      inputSchema: {
        template_id: z.number().int(),
        subscriber_emails: z.array(z.string().email()).optional(),
        subscriber_ids: z.array(z.number().int()).optional(),
        subscriber_mode: z
          .enum(["default", "fallback", "external"])
          .optional()
          .describe("'external' sends to emails that are not subscribers."),
        from_email: z.string().optional(),
        subject: z.string().optional(),
        data: z.record(z.string(), z.unknown()).optional().describe("Available as {{ .Tx.Data.* }}."),
        headers: z.array(z.record(z.string(), z.string())).optional(),
        messenger: z.string().optional(),
        content_type: z.enum(["html", "markdown", "plain"]).optional(),
      },
    },
    guard(async (a) => {
      if (!a.subscriber_emails?.length && !a.subscriber_ids?.length) {
        throw new Error("Provide subscriber_emails or subscriber_ids.");
      }
      return ok(await client.post("/api/tx", compact(a)));
    }),
  );

  // =====================================================================
  // Misc / instance
  // =====================================================================
  server.registerTool(
    "get_dashboard",
    {
      title: "Dashboard counts",
      description: "Overall counts: subscribers, lists, campaigns, messages sent.",
      inputSchema: {},
    },
    guard(async () => ok(await client.get("/api/dashboard/counts"))),
  );

  server.registerTool(
    "get_instance_info",
    {
      title: "Instance info",
      description: "listmonk version, health and public config (root URL, from email, messengers).",
      inputSchema: {},
    },
    guard(async () => {
      const [health, config, about] = await Promise.allSettled([
        client.get("/api/health"),
        client.get("/api/config"),
        client.get("/api/about"),
      ]);
      const pick = (r: PromiseSettledResult<unknown>) => (r.status === "fulfilled" ? r.value : { error: String(r.reason) });
      return ok({ health: pick(health), config: pick(config), about: pick(about) });
    }),
  );

  // =====================================================================
  // Escape hatch: any listmonk API endpoint
  // =====================================================================
  server.registerTool(
    "listmonk_api_request",
    {
      title: "Raw listmonk API request",
      description:
        "Call any listmonk REST endpoint not covered by a dedicated tool (e.g. /api/bounces, /api/settings, " +
        "/api/users, /api/import/subscribers, /api/campaigns/:id/archive). Path must start with /api/. " +
        "Query params and JSON body are passed through. See https://listmonk.app/docs/apis/apis/.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z.string().regex(/^\/api\//, "Path must start with /api/"),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]))
          .optional(),
        body: z.unknown().optional().describe("JSON request body."),
      },
    },
    guard(async ({ method, path, query, body }) =>
      ok(await client.request(method, path, { query: query as Query | undefined, body, raw: true })),
    ),
  );
}
