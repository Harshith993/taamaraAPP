import type { Metadata } from "next";
import { Panel } from "@/components/ui";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { can } from "@/modules/identity/policy";
import { homePathFor, requireActor } from "@/modules/identity/session";
import { getCompany } from "@/modules/settings/company";
import { getSwitches, SWITCH_LABELS } from "@/modules/settings/service";
import { CompanyForm } from "./company-form";
import { SwitchesForm } from "./switches-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requireActor();
  const switches = can(actor, "admin.settings");
  const tax = can(actor, "admin.taxSettings");
  if (!switches && !tax) redirect(`${homePathFor(actor)}?denied=1`);
  const [current, company] = await Promise.all([switches ? getSwitches(db) : null, tax ? getCompany(db, actor) : null]);
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95]">Settings</h1>
        <p className="mt-1 text-[15px] text-ink-quiet">How the app works for everyone. Changes are recorded in the audit log.</p>
      </div>
      {current && (
        <Panel title="How we work">
          <SwitchesForm initial={current} labels={SWITCH_LABELS} />
        </Panel>
      )}
      {company && (
        <Panel title="Company details for GST invoices">
          <CompanyForm initial={company} />
        </Panel>
      )}
    </div>
  );
}
