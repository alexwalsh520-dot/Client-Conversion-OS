// Scheduler: converts a tag-added event into jobs, drains jobs via cron,
// and cancels pending jobs when a lead replies.

import { getServiceSupabase } from '@/lib/supabase';
import { resolveCadence } from './cadence';
import { loadEligibleVariants, pickVariantEpsilonGreedy } from './variants';
import { sendVariantAsDM } from './send';

interface TagAddedInput {
  client: string;             // tyson_sonnek
  subscriberId: string;       // Instagram user id
  setterName: string;         // amara
  leadName?: string;
  phone?: string;
  firstMsgAt: string;         // ISO — setter's first message timestamp
}

// =============================================================
// Schedule all follow-up jobs for a newly-tagged lead.
// =============================================================
export async function scheduleFollowups(input: TagAddedInput) {
  const sb = getServiceSupabase();
  const t0 = new Date(input.firstMsgAt).getTime();
  const cadence = resolveCadence(input.client);

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

  // Per-subscriber cache of "does this lead still have the AI-FOLLOWUP tag?".
  // Checked once per unique (client, subscriber) at the start of each loop
  // iteration. If the tag has been removed (by the setter's reply rule,
  // a manual untag, or anything else), we cancel every pending job for that
  // lead and skip the rest of their jobs in this drain.
  const tagActiveCache = new Map<string, boolean>();

  for (const job of due ?? []) {
    try {
      const cacheKey = `${job.client}:${job.subscriber_id}`;
      let stillActive = tagActiveCache.get(cacheKey);
      if (stillActive === undefined) {
        try {
          stillActive = await hasFollowupTag(job.client, job.subscriber_id);
        } catch (err) {
          // Fail open: if ManyChat's API is down we'd rather send one extra
          // follow-up than silently stop a whole campaign.
          // eslint-disable-next-line no-console
          console.error(`[followup] tag check failed for ${cacheKey}:`, err);
          stillActive = true;
        }
        tagActiveCache.set(cacheKey, stillActive);
        if (!stillActive) {
          await sb.rpc('followup_cancel_pending', { p_subscriber_id: job.subscriber_id });
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
        // Close job: add the `AI-CLOSED` tag in ManyChat so their archive
        // rule fires. subscriber_id is ManyChat's Contact Id (same value
        // we use for sends), so this is a direct API call.
        await addManyChatCloseTag(job.client, job.subscriber_id);
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
          status: 'failed', last_error: 'no eligible variants', updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        failed++;
        continue;
      }

      const { messageId } = await sendVariantAsDM({
        client: job.client,
        subscriberId: job.subscriber_id,
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
    zoe_and_emily: process.env.MANYCHAT_API_KEY_ZOE_EMILY,
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
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ManyChat ${endpoint} "${tagName}" failed (${res.status}): ${text}`);
  }
}

// Add the AI-CLOSED tag in ManyChat when a close job fires.
// ManyChat-side, a rule on this tag archives the conversation.
async function addManyChatCloseTag(client: string, subscriberId: string) {
  return manyChatTagCall('addTagByName', client, subscriberId, 'AI-CLOSED');
}

// Remove the AI-FOLLOWUP tag when a lead replies. Exported so the
// reply-received webhook can call it directly.
export async function removeManyChatFollowupTag(client: string, subscriberId: string) {
  return manyChatTagCall('removeTagByName', client, subscriberId, 'AI-FOLLOWUP');
}

// Check whether a ManyChat subscriber still has the AI-FOLLOWUP tag.
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
  return tags.some((t) => t.name === 'AI-FOLLOWUP');
}

// =============================================================
// Cancel all pending jobs for a subscriber + attribute reply
// + remove the AI-FOLLOWUP tag in ManyChat.
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
  // subscriber, then strip the AI-FOLLOWUP tag in ManyChat so the setter UI
  // reflects that this lead has exited AI management. Non-fatal if it fails.
  try {
    const { data: recentJob } = await sb
      .from('followup_jobs')
      .select('client')
      .eq('subscriber_id', params.subscriberId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentJob?.client) {
      await removeManyChatFollowupTag(recentJob.client, params.subscriberId);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[followup] remove AI-FOLLOWUP tag failed:', err);
  }

  return {
    cancelled: cancelled ?? 0,
    attributedSendId: attributed ?? null,
  };
}
