
create or replace function public.active_project_code(_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select active_project_code from public.profiles where id = _uid
$$;

create or replace function public.booking_project_code(_booking_id text)
returns text language sql stable security definer set search_path = public as $$
  select project_code from public.bookings where booking_id = _booking_id
$$;

alter table public.bookings
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;
create index if not exists bookings_assigned_to_idx on public.bookings(assigned_to);

drop policy if exists bookings_read on public.bookings;
create policy bookings_read on public.bookings
for select to authenticated
using (
  public.has_role(auth.uid(), 'admin'::app_role)
  or (
    public.is_writer(auth.uid())
    and project_code = public.active_project_code(auth.uid())
    and (assigned_to is null or assigned_to = auth.uid())
  )
);

drop policy if exists adj_read on public.adjustments;
create policy adj_read on public.adjustments
for select to authenticated
using (
  public.has_role(auth.uid(), 'admin'::app_role)
  or (
    public.is_writer(auth.uid())
    and public.booking_project_code(booking_id) = public.active_project_code(auth.uid())
  )
);

drop policy if exists "Authenticated can read booking documents" on public.booking_documents;
create policy booking_documents_read on public.booking_documents
for select to authenticated
using (
  public.has_role(auth.uid(), 'admin'::app_role)
  or (
    public.is_writer(auth.uid())
    and public.booking_project_code(booking_id) = public.active_project_code(auth.uid())
  )
);
