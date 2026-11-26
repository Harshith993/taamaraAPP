/** Excel download for the outside accountant: /api/v1/exports?kind=purchases&from=2026-04-01&to=2026-11-30 */
import { checkRate } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { apiActor, apiError, NO_STORE } from "@/lib/http";
import { buildExport } from "@/modules/finance/exports";
import { requestMeta } from "@/modules/identity/session";

export async function GET(request: Request) {
  try {
    const actor = await apiActor();
    checkRate(actor.userId, "export");
    const url = new URL(request.url);
    const { filename, buffer } = await buildExport(db, actor, url.searchParams.get("kind") ?? "", url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "", await requestMeta());
    return new Response(new Uint8Array(buffer), {
      headers: {
        ...NO_STORE,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
