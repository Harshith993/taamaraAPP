"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { addDocument, removeDocument, type AddDocumentInput } from "@/modules/documents/service";
import { requestMeta, requireActor } from "@/modules/identity/session";

export async function addDocumentAction(input: AddDocumentInput): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await addDocument(db, actor, input, await requestMeta());
    revalidatePath("/", "layout");
    return { ok: true, message: "Document added." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function removeDocumentAction(documentId: string): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await removeDocument(db, actor, documentId, await requestMeta());
    revalidatePath("/", "layout");
    return { ok: true, message: "Removed." };
  } catch (err) {
    return toActionError(err);
  }
}
