-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('PROOF', 'DOCUMENT');

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "processingError" TEXT,
ADD COLUMN     "purpose" "FilePurpose" NOT NULL DEFAULT 'DOCUMENT';

-- CreateIndex
CREATE INDEX "files_status_createdAt_idx" ON "files"("status", "createdAt");
