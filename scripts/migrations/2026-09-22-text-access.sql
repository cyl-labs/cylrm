-- Let a caller be given permission to send texts.
--
-- Reading the Texts screen was never restricted: a caller has always seen the
-- conversations on their own number. Only the message bar was founders-only,
-- so this column is about sending and nothing else.
--
-- Off by default, and deliberately not defaulted to true the way keypad_access
-- was: a text reaches a prospect from a number they will ring back, costs
-- money per segment, and cannot be unsent. Nobody is opted in by having been
-- hired. Admins are implicitly in without a row change, because a founder
-- could already text.
--
-- Additive, so it is safe to apply before the code that reads it — and it must
-- be, since the Team screen and both send routes select this column.

alter table app_user
  add column if not exists text_access boolean not null default false;
