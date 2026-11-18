-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
