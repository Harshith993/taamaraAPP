/** The ⌘K search: /api/v1/search?q=gupta (src/modules/search/service.ts). */
import { db } from "@/lib/db";
import { apiActor, apiError, NO_STORE } from "@/lib/http";
import { checkRate } from "@/lib/rate-limit";
import { globalSearch } from "@/modules/search/service";

export async function GET(request: Request) {
  try {
    const actor = await apiActor();
    checkRate(actor.userId, "search");
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ hits: await globalSearch(db, actor, q) }, { headers: NO_STORE });
  } catch (err) {
    return apiError(err);
  }
}
