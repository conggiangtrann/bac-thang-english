-- One row of learning progress per signed-in user.
create table if not exists public.progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.progress enable row level security;
create policy "read own progress" on public.progress for select using (auth.uid() = user_id);
create policy "insert own progress" on public.progress for insert with check (auth.uid() = user_id);
create policy "update own progress" on public.progress for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- AI calls per user per day, written only by the ai function (service role); users cannot touch it.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  calls int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;

create or replace function public.bump_ai_usage(p_user uuid, p_limit int)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into ai_usage (user_id, day, calls) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set calls = ai_usage.calls + 1
  returning calls into n;
  if n > p_limit then
    update ai_usage set calls = calls - 1 where user_id = p_user and day = current_date;
    return -1;
  end if;
  return p_limit - n;
end $$;
revoke all on function public.bump_ai_usage(uuid, int) from public, anon, authenticated;
