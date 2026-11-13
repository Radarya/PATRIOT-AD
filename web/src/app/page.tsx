import { cookies } from "next/headers";
import DashboardClient from "@/components/DashboardClient";
import { ViewMode } from "@/types";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const resolvedParams = await searchParams;
  const cookieStore = await cookies();

  // 1. Initial Theme from Cookie
  const themeCookie = cookieStore.get("patriot_theme")?.value;
  const initialTheme: "dark" | "light" =
    themeCookie === "light" ? "light" : "dark";

  // 2. Initial Tab: Priority 1 is URL ?tab=, Priority 2 is cookie, Priority 3 is MONITORING
  const tabVal = Array.isArray(resolvedParams?.tab)
    ? resolvedParams.tab[0]
    : resolvedParams?.tab;
  const paramTab = tabVal ? (tabVal.toUpperCase() as ViewMode) : undefined;
  const validTabs: ViewMode[] = ["MONITORING", "BENCHMARK", "FORENSIC"];
  const cookieTab = cookieStore.get("patriot_active_view")?.value?.toUpperCase() as ViewMode;

  let initialTab: ViewMode = "MONITORING";
  if (paramTab && validTabs.includes(paramTab)) {
    initialTab = paramTab;
  } else if (cookieTab && validTabs.includes(cookieTab)) {
    initialTab = cookieTab;
  }

  // 3. Initial Scenario: Always start clean on Baseline SCN-01 to prevent anomaly flashes on refresh
  const initialScenario = "SCN-01";

  return (
    <DashboardClient
      initialTheme={initialTheme}
      initialTab={initialTab}
      initialScenario={initialScenario}
    />
  );
}
