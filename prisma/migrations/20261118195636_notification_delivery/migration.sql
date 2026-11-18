-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "deliveredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "notifications_deliveredAt_createdAt_idx" ON "notifications"("deliveredAt", "createdAt");
