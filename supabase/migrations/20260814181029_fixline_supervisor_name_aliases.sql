-- Applied to production Supabase on 2026-08-14.
-- Match actual RH export spelling/order to the user-confirmed Fixline supervisory teams.

insert into public.kpi_productivity_team_assignment(name_key,mechanic_name,team_code,scope,role_label) values
(public.kpi_normalize_person_name('HANOTEL SEBASTIEN'),'Sebastien HANOTEL','A','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('SPREUX ANTHONY'),'Anthony SPREUX','A','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('COLAERT JEAN FRANCOIS'),'Jean Francois COLLAERT','A','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('CAVROIS GIOVANNY'),'Giovanni CAVROIS','B','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('CLABAUT JORDAN'),'Jordan CLABAUT','B','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('DEGARDIN JEAN MARC'),'Jean Marc DEGARDIN','B','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('THERON YVES MARIE'),'Yves-marie THERON','C','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('ARZU CORENTIN'),'Corentin ARZU','C','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('LEMAIRE JULIEN'),'Julien LEMAIRE','C','fixline','Superviseur Fixline')
on conflict(name_key) do update set
  mechanic_name=excluded.mechanic_name,
  team_code=excluded.team_code,
  scope=excluded.scope,
  role_label=excluded.role_label,
  active=true,
  updated_at=now();
