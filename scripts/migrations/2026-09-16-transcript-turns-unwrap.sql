-- 66 transcripts stored their turns as a JSON *string* instead of an array.
--
-- Found on 2026-09-16 while adding MMS media, by auditing every jsonb column
-- with `jsonb_typeof`. `call_recording.transcript_turns` held 66 rows of
-- `string` against 31 of `array`, spanning 2026-08-24 to 2026-09-15. All 66
-- also have `transcript_text`, so the symptom was never an empty sheet: the
-- text was readable and the clickable turn-by-turn view — the thing that seeks
-- the audio — silently had nothing to render.
--
-- Lossless, and no Deepgram spend. The inner string is the array's own JSON, so
-- `#>> '{}'` takes the text out of the jsonb string and `::jsonb` parses it
-- back. Checked before writing this: all 66 unwrap to `array`.
--
-- WHAT DID NOT CAUSE IT, because the obvious suspect is innocent and someone
-- will otherwise "fix" working code. `transcribe/route.ts` writes
-- `${JSON.stringify(turns)}::jsonb` through Drizzle, and that was measured on
-- the day against this database and returns `array` — Drizzle passes the
-- string as a plain text parameter and Postgres parses it at the cast.
--
-- What DOES double-encode is the **raw postgres.js client**: the same
-- expression through `postgres()` directly — tagged template or
-- `client.unsafe()` with a positional parameter — stores `string`, because
-- that driver JSON-encodes a parameter bound to a jsonb target. `sql.json(x)`
-- is the form that works there. So one-off scripts written against the raw
-- client are the shape of thing that produced these rows, which is worth
-- knowing before anybody rewrites the route.
update call_recording
set transcript_turns = (transcript_turns #>> '{}')::jsonb
where transcript_turns is not null
  and jsonb_typeof(transcript_turns) = 'string'
  and jsonb_typeof((transcript_turns #>> '{}')::jsonb) = 'array';
