
revoke execute on function public.active_project_code(uuid) from public, anon;
revoke execute on function public.booking_project_code(text) from public, anon;
grant execute on function public.active_project_code(uuid) to authenticated;
grant execute on function public.booking_project_code(text) to authenticated;
