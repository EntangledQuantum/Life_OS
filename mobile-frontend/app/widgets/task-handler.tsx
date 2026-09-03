import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import { StatusWidget } from "./status-widget";
import type { WidgetSnapshot } from "@/lib/widget-data";
import { getBaseUrl, getToken } from "@/lib/storage";
import { fetchWithTimeout } from "@/lib/api";

const WIDGET_CACHE_KEY = "lifeos_widget_snapshot";
/** Shorter than the app's: the launcher will not wait for us either. */
const WIDGET_TIMEOUT_MS = 6_000;

export async function readWidgetSnapshot(): Promise<WidgetSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(WIDGET_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WidgetSnapshot;
  } catch {
    return null;
  }
}

export async function writeWidgetSnapshot(data: WidgetSnapshot): Promise<void> {
  await AsyncStorage.setItem(WIDGET_CACHE_KEY, JSON.stringify(data));
}

async function setActivityFromWidget(activity: string): Promise<void> {
  const base = await getBaseUrl();
  const token = await getToken();
  if (!base || !token) return;
  try {
    /*
     * Deadlines matter more here than anywhere: this runs as a headless task
     * the launcher gave us a few seconds of, and RN's fetch has no timeout of
     * its own. An unreachable server would hold the task open until the OS
     * killed it, with the widget still showing the old number.
     */
    await fetchWithTimeout(
      `${base}/api/v1/session/active`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ activity }),
      },
      WIDGET_TIMEOUT_MS,
    );
    // Refresh dashboard into widget cache
    const res = await fetchWithTimeout(
      `${base}/api/v1/dashboard/today`,
      { headers: { Authorization: `Bearer ${token}` } },
      WIDGET_TIMEOUT_MS,
    );
    if (res.ok) {
      const dash = await res.json();
      const { dashboardToWidget } = await import("@/lib/widget-data");
      const snap = dashboardToWidget(dash, false);
      await writeWidgetSnapshot(snap);
    }
  } catch {
    /* offline — ignore */
  }
}

export async function widgetTaskHandler(
  props: WidgetTaskHandlerProps,
): Promise<void> {
  const name = props.widgetInfo.widgetName;
  // Real dp box for this placement — changes per device, per cell count, and
  // again on every WIDGET_RESIZED. The widget lays itself out from these.
  const { width, height } = props.widgetInfo;

  if (name !== "LifeOsStatus") {
    props.renderWidget(<StatusWidget data={null} width={width} height={height} />);
    return;
  }

  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED": {
      const data = await readWidgetSnapshot();
      props.renderWidget(
        <StatusWidget data={data} width={width} height={height} />,
      );
      break;
    }
    case "WIDGET_CLICK": {
      if (props.clickAction === "SET_ACTIVITY") {
        const activity = String(
          props.clickActionData?.activity ?? "",
        );
        if (activity) {
          await setActivityFromWidget(activity);
        }
      }
      // OPEN_APP is handled by deep link / default open
      const data = await readWidgetSnapshot();
      props.renderWidget(
        <StatusWidget data={data} width={width} height={height} />,
      );
      break;
    }
    case "WIDGET_DELETED":
      break;
    default:
      break;
  }
}
