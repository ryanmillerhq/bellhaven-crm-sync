// Lordicon "System Regular" animations (copied from zenith-web-app). Icons by Lordicon.com.
import check from "@/public/icons/lordicon/system-regular-31-check-hover-pinch.json";
import cross from "@/public/icons/lordicon/system-regular-29-cross-hover-cross-1.json";
import edit from "@/public/icons/lordicon/system-regular-114-edit-pencil-rename-hover-pinch.json";
import refresh from "@/public/icons/lordicon/system-regular-150-refresh-change-hover-pinch.json";
import warning from "@/public/icons/lordicon/system-regular-56-warning-hover-warning.json";
import info from "@/public/icons/lordicon/system-regular-28-info-hover-info.json";
import launch from "@/public/icons/lordicon/system-regular-122-launch-hover-launch.json";
import home from "@/public/icons/lordicon/system-regular-41-home-hover-pinch.json";
import history from "@/public/icons/lordicon/system-regular-141-history-hover-history.json";
import copy from "@/public/icons/lordicon/system-regular-99-copy-hover-copy.json";
import swap from "@/public/icons/lordicon/system-regular-154-swap-hover-swap.json";
import celebration from "@/public/icons/lordicon/system-regular-134-celebration-hover-celebration.json";
import arrowRight from "@/public/icons/lordicon/system-regular-506-arrow-right-hover-pinch.json";
import arrowLeft from "@/public/icons/lordicon/system-regular-507-arrow-left-hover-pinch.json";
import location from "@/public/icons/lordicon/system-regular-89-location-hover-spin.json";
import analytics from "@/public/icons/lordicon/system-regular-10-analytics-hover-analytics.json";
import note from "@/public/icons/lordicon/system-regular-152-sticky-note-hover-sticky-note.json";
import store from "@/public/icons/lordicon/system-regular-153-store-hover-store.json";
import verified from "@/public/icons/lordicon/system-regular-126-verified-hover-verified.json";
import flag from "@/public/icons/lordicon/system-regular-100-flag-hover-flag.json";

export const ICONS = {
  check, cross, edit, refresh, warning, info, launch, home, history, copy, swap, celebration, arrowRight, arrowLeft,
  location, analytics, note, store, verified, flag,
};
export type IconName = keyof typeof ICONS;
