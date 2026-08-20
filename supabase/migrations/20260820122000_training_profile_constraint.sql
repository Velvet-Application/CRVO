-- Autorise le profil FORMATEUR dans le référentiel d'accès applicatif.
alter table public.crvo_auth_users
  drop constraint if exists crvo_auth_users_access_profile_chk;

alter table public.crvo_auth_users
  add constraint crvo_auth_users_access_profile_chk
  check (access_profile = any (array[
    'admin'::text,
    'service_manager'::text,
    'team_manager'::text,
    'custom'::text,
    'transphere'::text,
    'transphere_manager'::text,
    'hr'::text,
    'trainer'::text
  ]));
