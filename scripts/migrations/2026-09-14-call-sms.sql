-- Texts to and from a prospect around a demo.
--
-- One use: the founder rings a prospect at demo time, nobody picks up, and a
-- text follows from the same number ("your demo's ready, I'll call you now").
-- Replies come back through the Telnyx webhook and are threaded under the
-- meeting. See `src/lib/sms.ts`.
--
-- Built 2026-09-14 and switched OFF. US texting from a local number needs a
-- 10DLC campaign approved by the carriers, and ours (TCR C3DSJFI) was still in
-- carrier review.
--
-- ORDERING — the opposite of most Call CRM migrations:
--   * Safe to apply AFTER the code is deployed. Nothing reads or writes this
--     table unless TELNYX_SMS_ENABLED=1, so the dormant code needs no table.
--   * Must be applied BEFORE that flag is set. With the flag on and no table,
--     the send route and the webhook both 500, and Telnyx retries the webhook
--     until it disables it.

create table if not exists call_sms (
  id serial primary key,

  -- Telnyx's id for the message, and the dedupe key: webhooks are retried, and
  -- a retried `message.received` must not store a reply (or push it) twice.
  telnyx_message_id text not null,
  constraint call_sms_telnyx_message_id_unique unique (telnyx_message_id),

  -- `out` | `in`. Text rather than an enum, like every other status column
  -- added since the enum rebuilds of August.
  direction text not null,
  from_number text not null,
  to_number text not null,
  -- Exactly what was sent or received. Nothing is added to an outbound text.
  body text not null,

  -- Outbound: `queued` | `sent` | `delivered` | `failed`, moved forward only
  -- by the webhook. Inbound: always `received`.
  status text not null,
  -- Why a text did not arrive, already in words a founder can act on.
  error text,

  -- All three resolved at write time, like `inbound_call`. `set null` rather
  -- than cascade: deleting a list must not be blocked by, or silently erase,
  -- a conversation with a prospect.
  meeting_id integer references call_meeting(id) on delete set null,
  call_lead_id integer references call_lead(id) on delete set null,
  -- Outbound: who sent it. Inbound: who it is for, i.e. who sent the text
  -- being answered, else whoever holds the number it arrived on.
  user_id integer references app_user(id) on delete set null,

  created_at timestamptz not null default now()
);

-- The meetings screen reads a thread per lead, oldest first.
create index if not exists call_sms_lead_idx
  on call_sms (call_lead_id, created_at);

-- How a reply finds the conversation it answers: the latest text we sent to
-- that number from the number it arrived on.
create index if not exists call_sms_reply_idx
  on call_sms (to_number, from_number, created_at desc)
  where direction = 'out';
