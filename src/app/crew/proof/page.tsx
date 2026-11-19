import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { ProofGrid } from "@/components/proof-grid";
import { ProofUploader } from "@/components/proof-uploader";
import { Notice, Panel } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDate, formatTime } from "@/lib/format";
import { can, crewAssignmentWhere, taskWhere } from "@/modules/identity/policy";
import { homePathFor, requireActor } from "@/modules/identity/session";
import { listProof, openRedoRequests, type ProofTargetKind } from "@/modules/proof/service";

export const metadata: Metadata = { title: "Add proof" };

/** The crew's "Add proof" screen: for their booking (?a=assignment) or for one task (?t=task). */
export default async function CrewProofPage({ searchParams }: { searchParams: Promise<{ a?: string; t?: string }> }) {
  const actor = await requireActor();
  if (actor.accountType !== "LABOUR") redirect(homePathFor(actor));
  const sp = await searchParams;
  const uuid = /^[0-9a-f-]{36}$/i;

  let target: { kind: ProofTargetKind; id: string };
  let title: string;
  let detail: string;
  if (sp.t && uuid.test(sp.t)) {
    const task = await db.task.findFirst({
      where: { AND: [{ id: sp.t }, taskWhere(actor)] },
      select: { id: true, title: true, dueAt: true, status: true, event: { select: { name: true } }, function: { select: { name: true } } },
    });
    if (!task) notFound();
    target = { kind: "task", id: task.id };
    title = task.title;
    detail = [task.event?.name, task.function?.name, task.dueAt ? `by ${formatTime(task.dueAt)}, ${formatDate(task.dueAt)}` : null].filter(Boolean).join(" · ");
  } else if (sp.a && uuid.test(sp.a)) {
    const a = await db.crewAssignment.findFirst({
      where: { AND: [{ id: sp.a }, crewAssignmentWhere(actor)] },
      select: { id: true, duty: true, event: { select: { name: true } } },
    });
    if (!a) notFound();
    target = { kind: "crewAssignment", id: a.id };
    title = a.duty;
    detail = a.event.name;
  } else {
    notFound();
  }

  const proof = await listProof(db, actor, { target });
  const redo = openRedoRequests(proof);

  return (
    <PortalShell title="Add proof" subtitle="Taamara Taamara · crew" back={{ href: "/crew", label: "Today" }}>
      <div className="flex flex-col gap-3.5">
        <section className="flex flex-col gap-1">
          <span className="label-mono text-[11.5px] text-ink-quiet">{detail}</span>
          <h1 className="font-condensed text-[34px] leading-[0.95]">{title}</h1>
        </section>
        {redo.length > 0 && <Notice tone="error">Please redo: {redo.map((r) => r.reviewNote).join(" · ")}</Notice>}
        {can(actor, "proof.upload") ? (
          <ProofUploader target={target} allowGallery={actor.switches.proofFromGallery} maxVideoSeconds={actor.switches.maxVideoSeconds} prompt="Take a clear photo or a short video of the finished work. Your supervisor checks it." />
        ) : (
          <Notice tone="info">Proof uploads are switched off for your login. Please ask your supervisor.</Notice>
        )}
        {proof.length > 0 && (
          <Panel title={`Sent · ${proof.length}`}>
            <div className="p-3.5">
              <ProofGrid items={proof} showAbout={false} uploaderView />
            </div>
          </Panel>
        )}
      </div>
    </PortalShell>
  );
}
