/**
 * Live updates for one conversation over Server-Sent Events. Each event only says "something
 * changed"; the screen then reloads the thread through the normal, permission-checked page.
 * A comment line every 25 s keeps proxies from closing the connection.
 */
import { checkRate } from "@/lib/rate-limit";
import { subscribe } from "@/lib/bus";
import { db } from "@/lib/db";
import { apiActor, apiError } from "@/lib/http";
import { canListen } from "@/modules/communication/chat";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await apiActor();
    checkRate(actor.userId, "channel.stream");
    const { id } = await params;
    if (!(await canListen(db, actor, id))) return Response.json({ error: "That conversation was not found." }, { status: 404 });
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const send = (text: string) => {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        };
        send("retry: 5000\n\n");
        const off = subscribe(`channel:${id}`, () => send(`event: message\ndata: {}\n\n`));
        const ping = setInterval(() => send(": ping\n\n"), 25_000);
        cleanup = () => {
          off();
          clearInterval(ping);
        };
        request.signal.addEventListener("abort", () => {
          cleanup();
          try {
            controller.close();
          } catch {}
        });
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
