-- A caller's own switch for hiding businesses open 24 hours.
--
-- APPLY BEFORE THE DEPLOY. The dial queue and its split count read
-- `app_user.hide_always_open` on every render of a dial screen. Deployed
-- first, that column is missing and the dialler stops handing out leads.
-- It defaults to false, which is today's behaviour exactly, so applying it
-- early changes nothing on the running app.
--
-- Why: Brian asked for 24/7 places to be kept out of his queue, on the
-- grounds that a business answering round the clock is a harder sell for a
-- receptionist. The call record does not agree with him — measured
-- 2026-09-19 over every dialled call to the lists that carry hours, the 888
-- always-open leads were answered on 37% of calls against 32% for the rest,
-- ruled themselves out at 81% against 80%, and booked at 1.5% against 1.7%.
-- On Google Maps "open 24 hours" is usually a one-person business that
-- listed its mobile, which is the customer rather than a company with
-- reception already covered.
--
-- So this is a per-caller preference and not a change to anyone's leads:
-- nothing is deleted, no import is filtered, and the leads stay in every
-- count and on every other screen. A founder can see what it is holding back
-- on the dial screen, and turning it off brings them straight back. Stripping
-- them at import would have been the cheap version and could not be undone.

alter table app_user
  add column if not exists hide_always_open boolean not null default false;
