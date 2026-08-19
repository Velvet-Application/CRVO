-- Anchor the A/B weekly alternation for the week of 17 August 2026.
-- Business reference confirmed on 2026-08-19: team B is on the morning shift this week.
update public.kpi_worktime_shift_config
set rotation_anchor_monday = date '2026-08-17',
    rotation_anchor_primary = false,
    updated_at = now()
where entity = 'CRVO'
  and team_code in ('A','B');
