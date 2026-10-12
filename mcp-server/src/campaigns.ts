import type { ListmonkClient } from "./client.js";

/** Campaign object as returned by GET /api/campaigns/:id (subset we care about). */
export interface Campaign {
  id: number;
  name: string;
  subject: string;
  from_email: string;
  type: string;
  content_type: string;
  body: string;
  body_source?: string | null;
  altbody?: string | null;
  send_at?: string | null;
  status: string;
  messenger: string;
  template_id?: number | null;
  tags?: string[] | null;
  headers?: Array<Record<string, string>> | null;
  attribs?: Record<string, unknown> | null;
  archive?: boolean;
  archive_template_id?: number | null;
  archive_meta?: Record<string, unknown> | null;
  archive_slug?: string | null;
  lists?: Array<{ id: number; name?: string }> | null;
  media?: Array<{ id: number }> | null;
  [k: string]: unknown;
}

/**
 * Fields accepted by POST/PUT /api/campaigns (campReq in cmd/campaigns.go).
 * `lists` and `media` are arrays of IDs on write.
 */
export interface CampaignWrite {
  name?: string;
  subject?: string;
  lists?: number[];
  from_email?: string;
  type?: string;
  content_type?: string;
  body?: string;
  body_source?: string | null;
  altbody?: string | null;
  send_at?: string | null;
  messenger?: string;
  template_id?: number | null;
  tags?: string[];
  headers?: Array<Record<string, string>>;
  attribs?: Record<string, unknown>;
  media?: number[];
  archive?: boolean;
  archive_template_id?: number | null;
  archive_meta?: Record<string, unknown>;
  archive_slug?: string | null;
}

/**
 * listmonk's PUT /api/campaigns/:id requires the full campaign payload
 * (it re-validates name/subject/lists). Convert a GET response into a write body.
 */
export function toWriteBody(c: Campaign): CampaignWrite {
  return {
    name: c.name,
    subject: c.subject,
    lists: (c.lists ?? []).map((l) => l.id),
    from_email: c.from_email,
    type: c.type,
    content_type: c.content_type,
    body: c.body,
    body_source: c.body_source ?? undefined,
    altbody: c.altbody ?? undefined,
    send_at: c.send_at ?? null,
    messenger: c.messenger,
    template_id: c.template_id ?? undefined,
    tags: c.tags ?? [],
    headers: c.headers ?? [],
    attribs: c.attribs ?? undefined,
    media: (c.media ?? []).map((m) => m.id),
    archive: c.archive ?? false,
    archive_template_id: c.archive_template_id ?? undefined,
    archive_meta: c.archive_meta ?? undefined,
    archive_slug: c.archive_slug ?? undefined,
  };
}

export async function getCampaign(client: ListmonkClient, id: number): Promise<Campaign> {
  return client.get<Campaign>(`/api/campaigns/${id}`);
}

/** Fetch, merge the given patch, PUT back. Returns the updated campaign. */
export async function patchCampaign(
  client: ListmonkClient,
  id: number,
  patch: CampaignWrite,
): Promise<Campaign> {
  const current = await getCampaign(client, id);
  const body: CampaignWrite = { ...toWriteBody(current), ...patch };
  return client.put<Campaign>(`/api/campaigns/${id}`, body);
}

export async function setStatus(client: ListmonkClient, id: number, status: string): Promise<Campaign> {
  return client.put<Campaign>(`/api/campaigns/${id}/status`, { status });
}
