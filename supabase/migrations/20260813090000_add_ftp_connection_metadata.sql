-- Paramètres non sensibles de connexion du flux FTP.
-- Les valeurs opérationnelles sont renseignées directement dans Supabase ;
-- le mot de passe reste exclusivement dans les secrets GitHub Actions.

alter table public.kpi_data_sources
  add column if not exists connection jsonb not null default '{}'::jsonb;

comment on column public.kpi_data_sources.connection is
  'Paramètres non sensibles du connecteur (host, port, username, remoteDir, secure). Aucun mot de passe.';
