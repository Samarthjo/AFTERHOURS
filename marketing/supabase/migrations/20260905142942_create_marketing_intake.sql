create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table private.marketing_campaigns (
  code text primary key,
  name text not null,
  placement text,
  creative text,
  active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint marketing_campaigns_code_check check (
    char_length(code) between 1 and 48
    and code ~ '^[a-z0-9][a-z0-9-]{0,47}$'
  ),
  constraint marketing_campaigns_name_check check (char_length(name) between 2 and 80),
  constraint marketing_campaigns_placement_check check (
    placement is null or char_length(placement) between 2 and 80
  ),
  constraint marketing_campaigns_creative_check check (
    creative is null or char_length(creative) between 2 and 80
  )
);

insert into private.marketing_campaigns (code, name, placement, creative)
values ('poster-launch-v1', 'Launch poster v1', 'Unassigned', 'City awake');

alter table private.marketing_campaigns enable row level security;

create table private.marketing_events (
  event_id uuid primary key,
  session_id uuid not null,
  campaign text not null references private.marketing_campaigns(code),
  event_name text not null,
  path text not null,
  viewport_bucket text not null,
  role text,
  action text,
  placement text,
  destination text,
  occurred_at timestamptz not null default now(),

  constraint marketing_events_campaign_check check (
    char_length(campaign) between 1 and 48
    and campaign ~ '^[a-z0-9][a-z0-9-]{0,47}$'
  ),
  constraint marketing_events_name_check check (event_name in (
    'landing_view',
    'story_opened',
    'how_to_play_opened',
    'cta_clicked',
    'game_open',
    'play_clicked',
    'signup_started',
    'signup_completed',
    'share_clicked',
    'poster_downloaded',
    'role_selected',
    'training_action',
    'poster_started',
    'poster_midpoint',
    'poster_completed'
  )),
  constraint marketing_events_path_check check (
    char_length(path) between 1 and 160
    and path ~ '^/[A-Za-z0-9._~%/-]*(#[A-Za-z0-9._~-]+)?$'
    and left(path, 2) <> '//'
  ),
  constraint marketing_events_viewport_check check (
    viewport_bucket in ('compact', 'regular', 'wide')
  ),
  constraint marketing_events_role_check check (
    role is null or role in ('architect', 'cultivator', 'engineer', 'operator', 'medic')
  ),
  constraint marketing_events_action_check check (
    action is null or action in ('architect', 'cultivator', 'engineer', 'operator', 'medic')
  ),
  constraint marketing_events_placement_check check (
    placement is null or placement in ('header', 'hero', 'role', 'pulse', 'final', 'mobile')
  ),
  constraint marketing_events_destination_check check (
    destination is null or destination in ('waitlist', 'game')
  ),
  constraint marketing_events_dimensions_check check (
    (
      event_name = 'role_selected'
      and role is not null
      and action is null
      and placement is null
      and destination is null
    )
    or (
      event_name = 'training_action'
      and action is not null
      and role is null
      and placement is null
      and destination is null
    )
    or (
      event_name = 'cta_clicked'
      and role is not null
      and action is null
      and placement is not null
      and destination is not null
    )
    or (
      event_name in ('play_clicked', 'game_open', 'signup_started', 'signup_completed')
      and action is null
      and placement is null
      and destination is null
    )
    or (
      event_name not in (
        'role_selected',
        'training_action',
        'cta_clicked',
        'play_clicked',
        'game_open',
        'signup_started',
        'signup_completed'
      )
      and role is null
      and action is null
      and placement is null
      and destination is null
    )
  )
);

comment on table private.marketing_events is
  'Pseudonymous, allowlisted landing-page funnel events. Does not store IP, user agent, referrer, email, or arbitrary metadata.';

alter table private.marketing_events enable row level security;

create index marketing_events_campaign_time_idx
  on private.marketing_events (campaign, occurred_at desc);

create index marketing_events_name_time_idx
  on private.marketing_events (event_name, occurred_at desc);

create index marketing_events_session_time_idx
  on private.marketing_events (session_id, occurred_at);

create table private.marketing_signups (
  signup_event_id uuid primary key,
  campaign text not null references private.marketing_campaigns(code),
  email text not null unique,
  callsign text,
  preferred_role text not null,
  consent boolean not null,
  privacy_version text not null,
  consented_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint marketing_signups_campaign_check check (
    char_length(campaign) between 1 and 48
    and campaign ~ '^[a-z0-9][a-z0-9-]{0,47}$'
  ),
  constraint marketing_signups_email_check check (
    email = lower(btrim(email))
    and char_length(email) between 3 and 254
    and email !~ '[[:space:]]'
    and email ~ '^[^@]+@[^@]+\.[^@]+$'
  ),
  constraint marketing_signups_callsign_check check (
    callsign is null
    or (
      callsign = btrim(callsign)
      and char_length(callsign) between 1 and 24
      and callsign !~ '[[:cntrl:]<>]'
    )
  ),
  constraint marketing_signups_role_check check (
    preferred_role in ('architect', 'cultivator', 'engineer', 'operator', 'medic')
  ),
  constraint marketing_signups_consent_check check (consent),
  constraint marketing_signups_privacy_version_check check (
    privacy_version = '2026-09-05'
  )
);

comment on table private.marketing_signups is
  'Opt-in playtest contacts. Browser session IDs are deliberately not stored here, preventing joins to pseudonymous browsing events.';

alter table private.marketing_signups enable row level security;

create index marketing_signups_campaign_time_idx
  on private.marketing_signups (campaign, consented_at desc);

create or replace function public.capture_marketing_event(
  p_event_id uuid,
  p_session_id uuid,
  p_campaign text,
  p_event_name text,
  p_path text,
  p_viewport_bucket text,
  p_role text,
  p_action text,
  p_placement text,
  p_destination text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into private.marketing_events (
    event_id,
    session_id,
    campaign,
    event_name,
    path,
    viewport_bucket,
    role,
    action,
    placement,
    destination
  ) values (
    p_event_id,
    p_session_id,
    p_campaign,
    p_event_name,
    p_path,
    p_viewport_bucket,
    p_role,
    p_action,
    p_placement,
    p_destination
  )
  on conflict (event_id) do nothing;
exception
  when check_violation
    or foreign_key_violation
    or not_null_violation
    or invalid_text_representation
    or string_data_right_truncation
  then
    raise exception using
      errcode = '22023',
      message = 'invalid marketing event';
end;
$$;

create or replace function public.register_marketing_signup(
  p_signup_event_id uuid,
  p_campaign text,
  p_email text,
  p_callsign text,
  p_preferred_role text,
  p_privacy_version text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into private.marketing_signups (
    signup_event_id,
    campaign,
    email,
    callsign,
    preferred_role,
    consent,
    privacy_version
  ) values (
    p_signup_event_id,
    p_campaign,
    lower(btrim(p_email)),
    nullif(btrim(p_callsign), ''),
    p_preferred_role,
    true,
    p_privacy_version
  )
  on conflict (email) do update
  set
    campaign = excluded.campaign,
    callsign = excluded.callsign,
    preferred_role = excluded.preferred_role,
    consent = true,
    privacy_version = excluded.privacy_version,
    consented_at = now(),
    updated_at = now();
exception
  when check_violation
    or foreign_key_violation
    or not_null_violation
    or invalid_text_representation
    or string_data_right_truncation
  then
    raise exception using
      errcode = '22023',
      message = 'invalid marketing signup';
end;
$$;

revoke all on table private.marketing_events from public, anon, authenticated;
revoke all on table private.marketing_signups from public, anon, authenticated;
revoke all on table private.marketing_campaigns from public, anon, authenticated;

revoke all on function public.capture_marketing_event(
  uuid, uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated;

revoke all on function public.register_marketing_signup(
  uuid, text, text, text, text, text
) from public, anon, authenticated;

grant usage on schema private to service_role;
grant insert on table private.marketing_events to service_role;
grant select, insert, update on table private.marketing_signups to service_role;
grant select on table private.marketing_campaigns to service_role;

grant execute on function public.capture_marketing_event(
  uuid, uuid, text, text, text, text, text, text, text, text
) to service_role;

grant execute on function public.register_marketing_signup(
  uuid, text, text, text, text, text
) to service_role;

create view private.marketing_funnel_daily
with (security_invoker = true)
as
select
  occurred_at::date as day,
  campaign,
  count(distinct session_id) filter (where event_name = 'landing_view') as landing_sessions,
  count(distinct session_id) filter (where event_name = 'poster_started') as poster_started_sessions,
  count(distinct session_id) filter (where event_name = 'poster_midpoint') as poster_midpoint_sessions,
  count(distinct session_id) filter (where event_name = 'poster_completed') as poster_completed_sessions,
  count(distinct session_id) filter (
    where event_name in ('role_selected', 'training_action')
  ) as explored_sessions,
  count(distinct session_id) filter (where event_name = 'cta_clicked') as cta_sessions,
  count(distinct session_id) filter (where event_name = 'game_open') as game_open_sessions,
  count(distinct session_id) filter (where event_name = 'signup_completed') as signup_sessions,
  round(
    100.0 * count(distinct session_id) filter (where event_name = 'cta_clicked')
    / nullif(count(distinct session_id) filter (where event_name = 'landing_view'), 0),
    1
  ) as landing_to_cta_pct,
  round(
    100.0 * count(distinct session_id) filter (where event_name = 'signup_completed')
    / nullif(count(distinct session_id) filter (where event_name = 'landing_view'), 0),
    1
  ) as landing_to_signup_pct
from private.marketing_events
group by occurred_at::date, campaign;

comment on view private.marketing_funnel_daily is
  'Daily distinct-session QR funnel by allowlisted campaign. Use landing_view as the scan proxy.';

revoke all on table private.marketing_funnel_daily from public, anon, authenticated;
grant select on table private.marketing_funnel_daily to service_role;

notify pgrst, 'reload schema';
