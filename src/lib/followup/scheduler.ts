// Scheduler: converts a tag-added event into jobs, drains jobs via cron,
// and cancels pending jobs when a lead replies.

import { getServiceSupabase } from '@/lib/supabase';
import { resolveCadence } from './cadence';
import { loadEligibleVariants, pickVariantEpsilonGreedy } from './variants';
import { sendVariantAsDM } from './send';

interface TagAddedInput {
  client: string;             // tyson_sonnek
  subscriberId: string;       // Internal lead id (prefer Instagram user id)
  manychatSubscriberId?: string;
  setterName: string;         // amara
  leadName?: string;
  phone?: string;
  firstMsgAt: string;         // ISO — setter's first message timestamp
}

const DEFAULT_FOLLOWUP_TAGS = ['AI-FOLLOWUP', 'AI follow-up'];
const DEFAULT_CLOSE_TAGS = ['AI-CLOSED', 'A closed'];

function uniqueNames(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getConfiguredTagNames(envValue: string | undefined, fallback: string[]) {
  const configured = (envValue ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return uniqueNames(configured.length > 0 ? configured : fallback);
}

function getFollowupTagNames() {
  return getConfiguredTagNames(process.env.MANYCHAT_FOLLOWUP_TAG_NAMES, DEFAULT_FOLLOWUP_TAGS);
}

function getCloseTagNames() {
  return getConfiguredTagNames(process.env.MANYCHAT_CLOSE_TAG_NAMES, DEFAULT_CLOSE_TAGS);
}

function getPrimaryCloseTagName() {
  return getCloseTagNames()[0] ?? DEFAULT_CLOSE_TAGS[0];
}

function normalizeTagName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isOutsideMessagingWindowError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('without a message tag') ||
    normalized.includes('last interaction was over') ||
    normalized.includes('more than 24 hours ago') ||
    normalized.includes('24-hour')
  );
}

function resolveScheduleBaseTime(firstMsgAt: string) {
  const parsed = new Date(firstMsgAt).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function resolveManyChatSubscriberId(job: {
  subscriber_id: string;
  metadata?: { manychat_subscriber_id?: unknown } | null;
}) {
  const raw = job.metadata?.manychat_subscriber_id;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : job.subscriber_id;
}

function collectLeadAliases(params: {
  subscriberId?: string | null;
  manychatSubscriberId?: string | null;
  metadata?: { manychat_subscriber_id?: unknown } | null;
}) {
  return uniqueNames([
    params.subscriberId ?? '',
    params.manychatSubscriberId ?? '',
    typeof params.metadata?.manychat_subscriber_id === 'string'
      ? params.metadata.manychat_subscriber_id
      : '',
  ]);
}

export async function cancelPendingFollowups(params: {
  client: string;
  subscriberId?: string | null;
  manychatSubscriberId?: string | null;
}) {
  const sb = getServiceSupabase();
  const aliases = collectLeadAliases(params);
  if (aliases.length === 0) return 0;

  const { data: pending, error: loadError } = await sb
    .from('followup_jobs')
    .select('id, subscriber_id, metadata')
    .eq('client', params.client)
    .eq('status', 'pending');

  if (loadError) {
    throw new Error(`cancelPendingFollowups load: ${loadError.message}`);
  }

  const aliasSet = new Set(aliases);
  const idsToCancel = (pending ?? [])
    .filter((job) =>
      collectLeadAliases({
        subscriberId: job.subscriber_id,
        metadata: job.metadata as { manychat_subscriber_id?: unknown } | null,
      }).some((value) => aliasSet.has(value)),
    )
    .map((job) => job.id);

  if (idsToCancel.length === 0) return 0;

  const { error: cancelError } = await sb
    .from('followup_jobs')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .in('id', idsToCancel)
    .eq('status', 'pending');

  if (cancelError) {
    throw new Error(`cancelPendingFollowups update: ${cancelError.message}`);
  }

  return idsToCancel.length;
}

// =============================================================
// Schedule all follow-up jobs for a newly-tagged lead.
// =============================================================
export async function scheduleFollowups(input: TagAddedInput) {
  const sb = getServiceSupabase();
  const t0 = resolveScheduleBaseTime(input.firstMsgAt);
  const cadence = await resolveCadence(input.client);

  await cancelPendingFollowups({
    client: input.client,
    subscriberId: input.subscriberId,
    manychatSubscriberId: input.manychatSubscriberId,
  });

  if (input.manychatSubscriberId) {
    try {
      await removeManyChatCloseTag(input.client, input.manychatSubscriberId);
    } catch (err) {
      console.error('[followup] remove close tag on re-tag failed:', err);
    }
  }

  const rows = cadence.map((c) => ({
    client: input.client,
    subscriber_id: input.subscriberId,
    type: c.slot === 'close' ? 'close' : 'send',
    slot: c.slot === 'close' ? null : Number(c.slot),
    scheduled_at: new Date(t0 + c.offsetMinutes * 60_000).toISOString(),
    status: 'pending',
    metadata: {
      setter_name: input.setterName,
      lead_name: input.leadName ?? null,
      phone: input.phone ?? null,
      manychat_subscriber_id: input.manychatSubscriberId ?? null,
    },
  }));

  const { error } = await sb.from('followup_jobs').insert(rows);
  if (error) throw new Error(`scheduleFollowups: ${error.message}`);
  return rows.length;
}

// =============================================================
// Drain due jobs. Called by /api/cron/followup-drain every minute.
// =============================================================
export async function drainDueJobs(limit = 100) {
  const sb = getServiceSupabase();
  const now = new Date().toISOString();

  const { data: due, error } = await sb
    .from('followup_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`drainDueJobs load: ${error.message}`);

  let sent = 0, failed = 0, closed = 0, cancelled = 0;

  // Per-subscriber cache of "does this lead still have the AI follow-up tag?".
  const tagActiveCache = new Map<string, boolean>();

  for (const job of due ?? []) {
    try {
      const manychatSubscriberId = resolveManyChatSubscriberId(job);
      const cacheKey = `${job.client}:${manychatSubscriberId}`;
      let stillActive = tagActiveCache.get(cacheKey);
      if (stillActive === undefined) {
        try {
          stillActive = await hasFollowupTag(job.client, manychatSubscriberId);
        } catch (err) {
          // Fail open: if ManyChat's API is down we'd rather send one extra
          // follow-up than silently stop a whole campaign.
          console.error(`[followup] tag check failed for ${cacheKey}:`, err);
          stillActive = true;
        }
        tagActiveCache.set(cacheKey, stillActive);
        if (!stillActive) {
          await cancelPendingFollowups({
            client: job.client,
            subscriberId: job.subscriber_id,
            manychatSubscriberId,
          });
        }
      }
      if (!stillActive) {
        cancelled++;
        continue;
      }

      // Claim the job atomically
      const { data: claimed, error: claimErr } = await sb
        .from('followup_jobs')
        .update({ status: 'running', updated_at: new Date().toISOString() })
        .eq('id', job.id)
        .eq('status', 'pending')
        .select('id')
        .single();
      if (claimErr || !claimed) {
        cancelled++;
        continue;
      }

      if (job.type === 'close') {
        await removeManyChatFollowupTag(job.client, manychatSubscriberId);
        await addManyChatCloseTag(job.client, manychatSubscriberId);
        await sb.from('followup_jobs').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', job.id);
        closed++;
        continue;
      }

      // SEND job
      const slot = job.slot as number;
      const eligible = await loadEligibleVariants({
        client: job.client,
        slot,
        subscriberId: job.subscriber_id,
      });
      const variant = pickVariantEpsilonGreedy(eligible);
      if (!variant) {
        await sb.from('followup_jobs').update({
          status: 'failed',
          last_error: 'no eligible variants',
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        failed++;
        continue;
      }

      const { messageId } = await sendVariantAsDM({
        client: job.client,
        subscriberId: manychatSubscriberId,
        variant,
        setterName: (job.metadata?.setter_name as string) || 'amara',
      });

      await sb.from('followup_sends').insert({
        client: job.client,
        subscriber_id: job.subscriber_id,
        variant_id: variant.id,
        slot,
        job_id: job.id,
        scheduled_at: job.scheduled_at,
        sent_at: new Date().toISOString(),
        ig_message_id: messageId,
      });

      await sb.from('followup_jobs').update({
        status: 'sent',
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);

      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (isOutsideMessagingWindowError(msg)) {
        try {
          const manychatSubscriberId = resolveManyChatSubscriberId(job);
          await cancelPendingFollowups({
            client: job.client,
            subscriberId: job.subscriber_id,
            manychatSubscriberId,
          });
          await removeManyChatFollowupTag(job.client, manychatSubscriberId);
        } catch (cleanupErr) {
          console.error('[followup] cleanup after messaging-window failure failed:', cleanupErr);
        }
      }

      await sb.from('followup_jobs').update({
        status: 'failed',
        last_error: msg,
        attempts: (job.attempts ?? 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      failed++;
    }
  }

  return { processed: (due ?? []).length, sent, failed, closed, cancelled };
}

// =============================================================
// ManyChat helpers: resolve the per-client API key, add/remove tags.
// =============================================================
function getManyChatKey(client: string): string {
  const keyMap: Record<string, string | undefined> = {
    tyson_sonnek: process.env.MANYCHAT_API_KEY_TYSON,
    keith_holland: process.env.MANYCHAT_API_KEY_KEITH,
    lucy_hubbard: process.env.MANYCHAT_API_KEY_LUCY_HUBBARD,
  };
  const key = keyMap[client]?.trim();
  if (!key) {
    throw new Error(`No ManyChat API key configured for client "${client}"`);
  }
  return key;
}

async function manyChatTagCall(
  endpoint: 'addTagByName' | 'removeTagByName',
  client: string,
  subscriberId: string,
  tagName: string,
): Promise<void> {
  const key = getManyChatKey(client);
  const res = await fetch(`https://api.manychat.com/fb/subscriber/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      tag_name: tagName,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    status?: 'success' | 'error';
    message?: string;
  };
  if (!res.ok || payload.status === 'error') {
    throw new Error(
      `ManyChat ${endpoint} "${tagName}" failed (${res.status}): ${payload.message || 'unknown error'}`,
    );
  }
}

async function addManyChatCloseTag(client: string, subscriberId: string) {
  return manyChatTagCall('addTagByName', client, subscriberId, getPrimaryCloseTagName());
}

async function removeTagByAnyName(client: string, subscriberId: string, tagNames: string[]) {
  let lastError: Error | null = null;

  for (const tagName of uniqueNames(tagNames)) {
    try {
      await manyChatTagCall('removeTagByName', client, subscriberId, tagName);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error('No tag names configured');
}

async function removeManyChatCloseTag(client: string, subscriberId: string) {
  try {
    await removeTagByAnyName(client, subscriberId, getCloseTagNames());
  } catch {
    // Re-tag should still work even if the close tag is absent.
  }
}

// Remove the follow-up tag when a lead replies. Exported so the
// reply-received webhook can call it directly.
export async function removeManyChatFollowupTag(client: string, subscriberId: string) {
  try {
    await removeTagByAnyName(client, subscriberId, getFollowupTagNames());
    return;
  } catch (removeErr) {
    try {
      const stillActive = await hasFollowupTag(client, subscriberId);
      if (!stillActive) return;
    } catch {
      // fall through and surface the original removal error
    }
    throw removeErr;
  }
}

// Check whether a ManyChat subscriber still has the active follow-up tag.
// Returns true if present, false if not. Throws on network/API error.
async function hasFollowupTag(client: string, subscriberId: string): Promise<boolean> {
  const key = getManyChatKey(client);
  const url = `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ManyChat getInfo failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    status?: string;
    data?: { tags?: Array<{ name: string }> };
  };
  const tags = data.data?.tags ?? [];
  const expected = new Set(getFollowupTagNames().map(normalizeTagName));
  return tags.some((tag) => expected.has(normalizeTagName(tag.name)));
}

// =============================================================
// Cancel all pending jobs for a subscriber + attribute reply
// + remove the follow-up tag in ManyChat.
// Called from the Instagram webhook when an inbound message arrives.
// =============================================================
export async function cancelPendingAndAttributeReply(params: {
  subscriberId: string;
  replyText: string | null;
  receivedAt: string;
}) {
  const sb = getServiceSupabase();

  const { data: cancelled } = await sb.rpc('followup_cancel_pending', {
    p_subscriber_id: params.subscriberId,
  });

  const { data: attributed } = await sb.rpc('followup_attribute_reply', {
    p_subscriber_id: params.subscriberId,
    p_reply_text: params.replyText,
    p_received_at: params.receivedAt,
  });

  // Best-effort: derive client from the most recent followup_job for this
  // subscriber, then strip the active follow-up tag in ManyChat so the setter
  // UI reflects that this lead has exited AI management.
  try {
    const { data: recentJob } = await sb
      .from('followup_jobs')
      .select('client, metadata')
      .eq('subscriber_id', params.subscriberId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentJob?.client) {
      const manychatSubscriberId = resolveManyChatSubscriberId({
        subscriber_id: params.subscriberId,
        metadata: recentJob.metadata as { manychat_subscriber_id?: unknown } | null,
      });
      await removeManyChatFollowupTag(recentJob.client, manychatSubscriberId);
    }
  } catch (err) {
    console.error('[followup] remove AI follow-up tag failed:', err);
  }

  return {
    cancelled: cancelled ?? 0,
    attributedSendId: attributed ?? null,
  };
}
