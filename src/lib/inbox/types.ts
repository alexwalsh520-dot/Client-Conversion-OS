export interface InboxConversation {
  everfit_id: string;
  name: string;
  coach_name: string | null;
  owner: string;
  client_id: number | null;
  last_captured_at: string | null;
  synced_through: string | null;
  history_complete: boolean;
  checkpoint_id: string | null;
  message_count: number;
}
export interface InboxMessage {
  message_id: string;
  sender: string;
  text: string;
  date: string;
  time: string;
  attachments: boolean;
  observed_at?: string;
}
