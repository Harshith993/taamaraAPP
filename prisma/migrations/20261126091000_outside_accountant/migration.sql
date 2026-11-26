-- D56 (26 Nov): the accountant is an outside person who logs in, so the role covers money only.
-- Taken away: run sheets and requirements, proof photos, the crew directory (phones, emergency
-- contacts), booking documents and direct threads. Hosts can give any of these back on the Roles page.
DELETE FROM "role_permissions"
WHERE "roleId" = (SELECT "id" FROM "roles" WHERE "key" = 'ACCOUNTANT')
  AND "permission" IN ('schedule.view', 'requirements.view', 'proof.view', 'crew.view', 'documents.view', 'documents.upload', 'chat.direct');

UPDATE "roles"
SET "description" = 'The outside accountant: client billing, vendor invoices, payments, expenses and exports. Money only; no chats, crew personal details or photos.'
WHERE "key" = 'ACCOUNTANT';
