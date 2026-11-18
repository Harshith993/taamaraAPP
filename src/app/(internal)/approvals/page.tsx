import type { Metadata } from "next";
import { EmptyState, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDate, formatINR, formatTime } from "@/lib/format";
import { listPendingApprovals, type PendingApproval } from "@/modules/approvals/service";
import { requirePermission } from "@/modules/identity/session";
import { DecisionButtons } from "./decision-buttons";

export const metadata: Metadata = { title: "Approvals" };

const KIND_LABEL = { quote: "Vendor quote", payment: "Payment", crew: "Crew pay extra", missing: "Needs attention" } as const;

export default async function ApprovalsPage() {
  const actor = await requirePermission("approvals.decide");
  const items = await listPendingApprovals(db, actor);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95]">APPROVALS · {items.length}</h1>
        <p className="mt-1 text-[15px] text-ink-quiet">Quotes, payments and crew extras waiting for an owner. Everything you decide is kept in the audit log.</p>
      </div>
      {items.length === 0 ? (
        <Panel>
          <EmptyState title="Nothing waiting">New quotes, payments and crew extras appear here.</EmptyState>
        </Panel>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-4">
          {items.map((item) => (
            <ApprovalCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ item }: { item: PendingApproval }) {
  const warning =
    item.kind === "payment" && item.selfPrepared
      ? "You prepared this payment, so the other owner needs to approve it."
      : item.kind === "payment" && item.isFinal && item.approvedProof === 0
        ? "Final payment: no approved proof of this vendor's work yet."
        : null;

  return (
    <Panel
      title={KIND_LABEL[item.kind]}
      action={item.amount !== null ? <span className="font-mono text-[15px] font-semibold">{formatINR(item.amount)}</span> : undefined}
    >
      <div className="flex flex-col gap-3 px-3.5 py-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-[16px] leading-tight font-bold">{item.summary}</p>
          <p className="text-[13px] text-ink-quiet">
            {"event" in item && item.event ? `${item.event.name} · ` : ""}
            {item.requestedBy ? `asked by ${item.requestedBy} · ` : ""}
            {formatDate(item.createdAt)} {formatTime(item.createdAt)}
          </p>
        </div>

        {item.kind === "quote" && (
          <>
            <p className="text-[14px]">
              <strong>{item.vendor}</strong> · {item.scope}
              {item.functions.length ? ` · ${item.functions.join(", ")}` : ""} · version {item.version}
            </p>
            <table className="w-full border-collapse text-[13.5px]">
              <tbody>
                {item.items.map((i, n) => (
                  <tr key={n} className="border-b border-rule-soft">
                    <td className="py-1.5 pr-2">{i.description}</td>
                    <td className="py-1.5 text-right font-mono">{formatINR(i.amount, { decimals: true })}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-1.5 pr-2 text-ink-quiet">GST</td>
                  <td className="py-1.5 text-right font-mono text-ink-quiet">{formatINR(item.tax, { decimals: true })}</td>
                </tr>
                <tr className="border-t-2 border-ink font-semibold">
                  <td className="py-1.5 pr-2">Total</td>
                  <td className="py-1.5 text-right font-mono">{formatINR(item.total)}</td>
                </tr>
              </tbody>
            </table>
            {item.rivals.length > 0 && (
              <div className="rounded-[3px] bg-ground px-3 py-2">
                <p className="label-mono mb-1 text-[11px]">Other {item.department ?? ""} quotes on this booking</p>
                {item.rivals.map((r) => (
                  <p key={r.vendor} className="flex justify-between text-[13.5px]">
                    <span>{r.vendor}</span>
                    <span className="font-mono">{r.total !== null ? `${formatINR(r.total)} (v${r.version})` : "no quote yet"}</span>
                  </p>
                ))}
              </div>
            )}
          </>
        )}

        {item.kind === "payment" && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13.5px]">
            <span className="text-ink-quiet">To</span>
            <span className="font-semibold">{item.party}</span>
            <span className="text-ink-quiet">Method</span>
            <span>{item.method}</span>
            {item.invoice && (
              <>
                <span className="text-ink-quiet">Invoice</span>
                <span>
                  {item.invoice.number} · {formatINR(item.invoice.total)}
                </span>
              </>
            )}
            {item.agreed > 0 && (
              <>
                <span className="text-ink-quiet">Agreed for this booking</span>
                <span className="font-mono">{formatINR(item.agreed)}</span>
                <span className="text-ink-quiet">Paid so far</span>
                <span className="font-mono">{formatINR(item.paidSoFar)}</span>
              </>
            )}
            <span className="text-ink-quiet">Approved proof</span>
            <span>{item.approvedProof > 0 ? <Tag tone="ok">{item.approvedProof} APPROVED</Tag> : <Tag tone="quiet">NONE YET</Tag>}</span>
            {item.note && (
              <>
                <span className="text-ink-quiet">Note</span>
                <span>{item.note}</span>
              </>
            )}
          </div>
        )}

        {item.kind === "crew" && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13.5px]">
            <span className="text-ink-quiet">Crew member</span>
            <span className="font-semibold">{item.worker}</span>
            <span className="text-ink-quiet">Duty</span>
            <span>{item.duty}</span>
            <span className="text-ink-quiet">Agreed pay for the event</span>
            <span className="font-mono">{formatINR(item.agreedPay)}</span>
            <span className="text-ink-quiet">{item.adjustmentType === "EXTRA" ? "Extra" : "Deduction"}</span>
            <span>{item.reason}</span>
          </div>
        )}

        {item.kind === "missing" ? (
          <p className="text-[13.5px] text-now">The record behind this request is missing. It can be safely ignored.</p>
        ) : (
          <DecisionButtons id={item.id} canRevise={item.kind === "quote"} warning={warning} />
        )}
      </div>
    </Panel>
  );
}
