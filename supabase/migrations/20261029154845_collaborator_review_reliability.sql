-- A completed response is tied to its user message, so retrying a lost response
-- returns the saved reply instead of appending the same reply again.
alter table public.chat_messages add column reply_to uuid references public.chat_messages(id);
create unique index chat_messages_one_reply on public.chat_messages(reply_to) where reply_to is not null;

create or replace function app_private.messages_reply_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.reply_to is not null then
    if new.role <> 'assistant' or not exists (
      select 1 from public.chat_messages m where m.id = new.reply_to and m.chat_id = new.chat_id and m.role = 'user'
    ) then
      raise exception 'A reply must reference a user message in the same chat' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.messages_reply_guard() from public, anon, authenticated;
create trigger chat_messages_reply_guard before insert on public.chat_messages
  for each row execute function app_private.messages_reply_guard();

-- This guard runs before review history is stamped; failed approvals leave no history entry.
create or replace function app_private.reviews_require_ready() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'approved' and not exists (
    select 1 from public.versions v
    where v.id = new.version_id
      and nullif(btrim(v.file_path), '') is not null
      and v.render->>'state' = 'ready'
      and jsonb_typeof(v.qa) = 'array'
      and not exists (select 1 from jsonb_array_elements(v.qa) q where q->>'status' = 'fail')
  ) then
    raise exception 'The media must be ready and failed checks resolved before approving this version' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function app_private.reviews_require_ready() from public, anon, authenticated;
create trigger reviews_require_ready before insert or update on public.reviews
  for each row execute function app_private.reviews_require_ready();
