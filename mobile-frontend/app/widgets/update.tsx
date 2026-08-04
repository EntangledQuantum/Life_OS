import { Platform } from "react-native";
import { requestWidgetUpdate } from "react-native-android-widget";
import type { DashboardToday } from "@/lib/types";
import { dashboardToWidget } from "@/lib/widget-data";
import { writeWidgetSnapshot } from "./task-handler";
import { StatusWidget } from "./status-widget";
import React from "react";

export async function pushWidgetFromDashboard(
  dashboard: DashboardToday,
  offline = false,
): Promise<void> {
  const snap = dashboardToWidget(dashboard, offline);
  await writeWidgetSnapshot(snap);

  if (Platform.OS !== "android") return;

  try {
    await requestWidgetUpdate({
      widgetName: "LifeOsStatus",
      renderWidget: () => <StatusWidget data={snap} />,
      widgetNotFound: () => {
        /* no widgets placed */
      },
    });
  } catch {
    /* Expo Go / no native module yet */
  }
}
