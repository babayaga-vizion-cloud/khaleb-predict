create extension if not exists pgcrypto;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  alias text,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  player_home_id uuid references public.players(id) on delete set null,
  player_away_id uuid references public.players(id) on delete set null,
  home_team text not null,
  away_team text not null,
  match_date timestamptz,
  home_score integer check (home_score between 0 and 30),
  away_score integer check (away_score between 0 and 30),
  source text default 'manual',
  validation_status text not null default 'pending' check (validation_status in ('pending', 'validated', 'rejected')),
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.odds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  home_odds numeric check (home_odds is null or home_odds > 1),
  draw_odds numeric check (draw_odds is null or draw_odds > 1),
  away_odds numeric check (away_odds is null or away_odds > 1),
  over_25_odds numeric check (over_25_odds is null or over_25_odds > 1),
  under_25_odds numeric check (under_25_odds is null or under_25_odds > 1),
  created_at timestamptz not null default now()
);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_coupon_id text,
  stake numeric check (stake is null or stake >= 0),
  total_odds numeric check (total_odds is null or total_odds > 0),
  potential_return numeric check (potential_return is null or potential_return >= 0),
  status text not null default 'pending',
  source text default 'manual',
  created_at timestamptz not null default now()
);

create table if not exists public.coupon_selections (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  selection_type text not null,
  selection_value text not null,
  odds numeric check (odds is null or odds > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  model_version text not null,
  method text not null,
  home_win_probability numeric check (home_win_probability is null or (home_win_probability between 0 and 1)),
  draw_probability numeric check (draw_probability is null or (draw_probability between 0 and 1)),
  away_win_probability numeric check (away_win_probability is null or (away_win_probability between 0 and 1)),
  predicted_home_score integer check (predicted_home_score is null or (predicted_home_score between 0 and 30)),
  predicted_away_score integer check (predicted_away_score is null or (predicted_away_score between 0 and 30)),
  predicted_exact_score text,
  over_25_probability numeric check (over_25_probability is null or (over_25_probability between 0 and 1)),
  under_25_probability numeric check (under_25_probability is null or (under_25_probability between 0 and 1)),
  btts_probability numeric check (btts_probability is null or (btts_probability between 0 and 1)),
  created_at timestamptz not null default now()
);

create table if not exists public.model_performance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  model_version text not null,
  evaluation_period_start timestamptz,
  evaluation_period_end timestamptz,
  accuracy double precision,
  log_loss double precision,
  brier_score double precision,
  total_matches integer,
  metrics jsonb,
  created_at timestamptz not null default now()
);

alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.odds enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_selections enable row level security;
alter table public.predictions enable row level security;
alter table public.model_performance enable row level security;

do $$
declare t text;
begin
  foreach t in array array['players','matches','odds','coupons','coupon_selections','predictions','model_performance'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
  end loop;
end $$;

create policy players_owner_all on public.players for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy matches_owner_all on public.matches for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy odds_owner_all on public.odds for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy coupons_owner_all on public.coupons for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy coupon_selections_owner_all on public.coupon_selections for all to authenticated
  using (
    exists (select 1 from public.coupons c where c.id = coupon_id and c.user_id = auth.uid())
    and exists (select 1 from public.matches m where m.id = match_id and m.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.coupons c where c.id = coupon_id and c.user_id = auth.uid())
    and exists (select 1 from public.matches m where m.id = match_id and m.user_id = auth.uid())
  );
create policy predictions_owner_all on public.predictions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy model_performance_owner_all on public.model_performance for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists matches_user_date_idx on public.matches(user_id, match_date);
create index if not exists matches_user_validation_idx on public.matches(user_id, validation_status, is_test);
create index if not exists odds_user_match_idx on public.odds(user_id, match_id);
create index if not exists coupons_user_created_idx on public.coupons(user_id, created_at desc);
create index if not exists predictions_user_created_idx on public.predictions(user_id, created_at desc);
create index if not exists predictions_user_match_idx on public.predictions(user_id, match_id);
