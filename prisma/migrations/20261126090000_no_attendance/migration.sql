-- D52 (26 Nov): the hosts don't track attendance. Nobody marks crew present, late or absent any more,
-- and crew don't check themselves in. Existing crew_shifts attendance values are kept as they are.
--
-- The old "attendance.mark" permission also opened Event day and run-sheet ticks for managers and
-- supervisors; that part is now "eventDay.run". Crew lose it altogether.
UPDATE "role_permissions" rp
SET "permission" = 'eventDay.run', "scope" = CASE WHEN rp."scope" = 'OWN' THEN 'ASSIGNED'::"PermissionScope" ELSE rp."scope" END
FROM "roles" r
WHERE r."id" = rp."roleId" AND rp."permission" = 'attendance.mark' AND r."accountType" = 'INTERNAL'
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."roleId" = rp."roleId" AND x."permission" = 'eventDay.run');

DELETE FROM "role_permissions" WHERE "permission" = 'attendance.mark';

-- The crew self check-in switch is retired.
UPDATE "company_profile" SET "settings" = "settings" - 'crewSelfCheckIn' WHERE "settings" ? 'crewSelfCheckIn';
