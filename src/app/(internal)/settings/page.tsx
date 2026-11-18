import type { Metadata } from "next";
import { Panel } from "@/components/ui";
import { db } from "@/lib/db";
import { requirePermission } from "@/modules/identity/session";
import { getSwitches, SWITCH_LABELS } from "@/modules/settings/service";
import { SwitchesForm } from "./switches-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePermission("admin.settings");
  const switches = await getSwitches(db);
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95] uppercase">Settings</h1>
        <p className="mt-1 text-[15px] text-ink-quiet">How crew, vendors and proof work for everyone. Changes are recorded in the audit log.</p>
      </div>
      <Panel title="Crew and proof">
        <SwitchesForm initial={switches} labels={SWITCH_LABELS} />
      </Panel>
    </div>
  );
}
