import {
  Armchair,
  BadgeCheck,
  CalendarDays,
  Camera,
  FileText,
  Home,
  IndianRupee,
  LayoutList,
  MoonStar,
  Receipt,
  Settings,
  Store,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** One icon per page in the staff menu (also used by the search). */
export const NAV_ICONS: Record<string, LucideIcon> = {
  "/home": Home,
  "/bookings": LayoutList,
  "/calendar": CalendarDays,
  "/event-day": MoonStar,
  "/vendors": Store,
  "/roster": UsersRound,
  "/proof": Camera,
  "/equipment": Armchair,
  "/money": IndianRupee,
  "/invoices": FileText,
  "/expenses": Receipt,
  "/advances": Wallet,
  "/approvals": BadgeCheck,
  "/team": Users,
  "/settings": Settings,
};

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
  /** Sidebar section. */
  group: "Work" | "People" | "Operations" | "Money" | "Admin";
}

export const NAV_GROUPS: NavItem["group"][] = ["Work", "People", "Operations", "Money", "Admin"];
