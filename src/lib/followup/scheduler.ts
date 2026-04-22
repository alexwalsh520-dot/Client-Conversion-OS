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

  for (const job of due ?? []) {
    try {
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

// =============================================================
// Cancel all pending jobs for a subscriber + attribute reply.
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

  return {
    cancelled: cancelled ?? 0,
    attributedSendId: attributed ?? null,
  };
}
