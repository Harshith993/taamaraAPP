-- AlterTable
ALTER TABLE "users" ADD COLUMN     "title" TEXT;

-- The two people with full access are called Host and Co-host in the app (owner's request, 19 Nov).
-- The role key stays OWNER inside the code.
UPDATE "roles" SET "name" = 'Host', "description" = 'The host and co-host (founder and co-founder). Full access to everything; cannot be restricted.' WHERE "key" = 'OWNER';
