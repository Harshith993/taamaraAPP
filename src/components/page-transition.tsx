"use client";

/**
 * Moving between pages: the old page fades away quickly and the new one rises gently into place,
 * while the header (named "site-header") stays still. Uses React's <ViewTransition> with the browser's
 * View Transitions API; browsers without it simply switch pages. Styles are in globals.css.
 */
import { usePathname } from "next/navigation";
import { ViewTransition } from "react";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={pathname} enter="page-in" exit="page-out" default="none">
      {children}
    </ViewTransition>
  );
}
