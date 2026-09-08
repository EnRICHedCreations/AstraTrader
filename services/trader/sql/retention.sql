-- AstraTrader production retention policy.
-- Applied to Supabase project separately; this file keeps the policy versioned with the service.
-- Raw blockchain observations and wallet entities are intentionally preserved because wallet
-- qualification depends on historical round trips.

create table if not exists public.astratrader_retention_state (
  id boolean primary key default true check (id),
  last_run timestamptz not null default 'epoch'::timestamptz
);

insert into public.astratrader_retention_state(id,last_run)
values (true,'epoch') on conflict (id) do nothing;

create or replace function public.astratrader_run_retention()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff_ms bigint := floor(extract(epoch from (now() - interval '2 hours')) * 1000)::bigint;
  signal_cutoff_ms bigint := floor(extract(epoch from (now() - interval '24 hours')) * 1000)::bigint;
  current_minute_bucket bigint := floor(extract(epoch from now()) / 60)::bigint;
begin
  delete from public.astratrader_jobs
    where state in ('done','dead')
      and available < floor(extract(epoch from (now() - interval '15 minutes')) * 1000)::bigint;

  delete from public.astratrader_events
    where at < cutoff_ms
      and kind in (
        'WALLET_SCORE','INVENTORY_TRANSFER','WALLET_BUY','WALLET_SELL',
        'SIGNAL_REJECTED','EQUITY','INGEST_RETRY','PIPELINE_ERROR'
      );

  delete from public.astratrader_entities
    where kind='signal' and at < signal_cutoff_ms;

  delete from public.astratrader_entities e
    where e.kind='edge'
      and e.id not in (
        select id from public.astratrader_entities
        where kind='edge'
        order by at desc
        limit 20000
      );

  delete from public.astratrader_meta
    where key like 'signal:%'
      and substring(key from '([0-9]+)$') is not null
      and substring(key from '([0-9]+)$')::bigint < current_minute_bucket - 1440;
end;
$$;

create or replace function public.astratrader_retention_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean;
begin
  update public.astratrader_retention_state
     set last_run = now()
   where id = true
     and last_run < now() - interval '15 minutes'
  returning true into claimed;

  if claimed then
    perform public.astratrader_run_retention();
  end if;
  return new;
end;
$$;

drop trigger if exists astratrader_retention_on_jobs on public.astratrader_jobs;
create trigger astratrader_retention_on_jobs
after insert or update on public.astratrader_jobs
for each statement execute function public.astratrader_retention_trigger();
