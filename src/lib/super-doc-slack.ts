import { postToSlack } from './slack';
import type { SuperDocEventType, SuperDocLead } from './super-doc-types';

const DEFAULT_SUPER_DOC_SLACK_CHANNEL = 'C0AFKJUQ2UT';

function clean(value?: string | null) {
  return (value || '').trim();
}

function getSuperDocSlackChannel() {
  return (
    clean(process.env.SUPER_DOC_SLACK_CHANNEL_ID) ||
    clean(process.env.SLACK_CHANNEL_SUPER_DOC) ||
    DEFAULT_SUPER_DOC_SLACK_CHANNEL
  );
}

function eventLabel(eventType: SuperDocEventType) {
  switch (eventType) {
    case 'open':
      return 'opened the Super Doc';
    case 'video_play':
      return 'started watching the video';
    case 'video_progress':
      return 'watched more of the video';
    case 'video_complete':
      return 'finished the video';
    case 'video_pause':
      return 'paused the video';
    case 'read_progress':
      return 'read more of the Super Doc';
    default:
      return eventType;
  }
}

export async function notifySuperDocActivity(input: {
  lead: SuperDocLead;
  eventType: SuperDocEventType;
  pageUrl: string;
  eventData?: Record<string, unknown>;
}) {
  if (!['open', 'video_play', 'video_progress', 'video_complete'].includes(input.eventType)) {
    return false;
  }

  const channel = getSuperDocSlackChannel();
  if (!channel) return false;

  const lead = input.lead;
  const eventData = input.eventData || {};
  const readPercent = Number(lead.max_scroll_percent || eventData.readPercent || 0);
  const videoPercent = Number(lead.video_watch_percent || eventData.percent || 0);
  const videoPlays = Number(lead.video_play_count || 0);
  const viewCount = Number(lead.view_count || 0);

  const lines = [
    `*Super Doc activity:* ${eventLabel(input.eventType)}`,
    `*Lead:* ${lead.first_name} ${lead.last_name}`.trim(),
    `*Email:* ${lead.email || 'No email'}`,
    `*Segment:* ${lead.lead_type || 'Unknown'}`,
    `*Opened:* ${lead.opened_at ? 'Yes' : 'No'} (${viewCount} view${viewCount === 1 ? '' : 's'})`,
    `*Read:* ${readPercent || 0}%`,
    `*Video:* ${videoPercent || 0}% watched, ${videoPlays} play${videoPlays === 1 ? '' : 's'}`,
    `*Doc:* ${input.pageUrl}`,
  ];

  return postToSlack(channel, lines.join('\n'));
}
