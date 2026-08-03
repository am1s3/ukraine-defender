import "./style.css";
import { fetchAlerts, fetchEvents, fetchNight } from "./api";
import { ThreatMap } from "./map";
import { Drawer } from "./panel";
import { SummaryOverlay } from "./summary";
import type { AlertResponse, ThreatEvent, NightResponse, Region } from "./types";

// ============================================================
// ERROR HANDLING
// ============================================================
window.addEventListener("unhandledrejection", (e) => {
  console.error("[UD] Unhandled rejection:", e.reason);
  toast({ text: "Сталася помилка. Оновіть сторінку.", kind: "warn" });
});

window.addEventListener("error", (e) => {
  console.error("[UD] Global error:", e.error);
  toast({ text: "Непередбачена помилка", kind: "warn" });
});

// ============================================================
// STATE
// ============================================================
let lastData: AlertResponse | null = null;
let lastEvents: ThreatEvent[] = [];
let lastNight: NightResponse | null = null;
let pollTimer: number | null = null;

const drawer = new Drawer({
  onHoverToponym: (key) => map.setHighlight(key),
  onFlyToponym: (key) => map.flyToponym(key),
  onRetry: () => { void pollEvents(); },
});

const map = new ThreatMap("map", (key) => {
  const r = lastData?.regions.find((x) => x.key === key);
  if (r) {
    drawer.open(r);
    if (r.active) pollEvents();
  }
});

const summaryOverlay = new SummaryOverlay();

// ============================================================
// POLLING
// ============================================================
async function pollAlerts() {
  try {
    const data = await fetchAlerts();
    lastData = data;

    console.log(`[UD] Alerts: ${data.active_alerts} active`);

    // Обновляем карту с тривогами
    map.updateAlerts(data.regions);

    // Обновляем status strip
    updateStatusStrip(data.regions);

  } catch (e) {
    console.error("[UD] Alert poll failed:", e);
    toast({ text: "Не вдалося отримати тривоги", kind: "warn" });
  }
}

async function pollEvents() {
  try {
    const region = drawer.currentKey() ?? "kyiv";
    const data = await fetchEvents(region);
    lastEvents = data.events;

    console.log(`[UD] Events: ${data.events_count}`);

    map.updateEvents(data.events);
    drawer.setEvents(data.events);

  } catch (e) {
    console.error("[UD] Event poll failed:", e);
    drawer.setError(e instanceof Error ? e.message : "Unknown error");
  }
}

// ============================================================
// STATUS STRIP
// ============================================================
function updateStatusStrip(regions: Region[]) {
  const strip = document.getElementById("statusStrip");
  const text = document.getElementById("statusText");

  if (!strip || !text) return;

  const alerts = regions.filter(r => r.alert);

  if (alerts.length === 0) {
    (strip as HTMLElement).dataset.state = "calm";
    text.textContent = "УСЕ ЧИСТО · ТРИМАЙМОСЬ";
  } else {
    (strip as HTMLElement).dataset.state = "alert";
    const names = alerts.slice(0, 3).map(r => r.name_uk).join(", ");
    const suffix = alerts.length > 3 ? "..." : "";
    text.textContent = `🚨 ТРИВОГА В ${alerts.length} РЕГІОНАХ: ${names}${suffix}`;
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = window.setInterval(async () => {
    await pollAlerts();
    if (drawer.isOpen()) await pollEvents();
  }, 15000);
}

// ============================================================
// NAVIGATION
// ============================================================
function setupNavigation() {
  document.querySelectorAll("[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = (btn as HTMLElement).dataset.nav;
      if (!target) return;

      const overlay = document.getElementById(`${target}Overlay`);
      if (overlay) (overlay as HTMLElement).dataset.open = "true";

      if (target === "report") {
        // ✅ ИСПРАВЛЕНО: правильный порядок параметров
        // open(events: ThreatEvent[], alerts: AlertResponse | null, night: NightResponse | null)
        void summaryOverlay.open(lastEvents, lastData, lastNight);
      }
    });
  });

  document.querySelectorAll(
    "[data-nav-close], [data-auth-close], [data-support-close], [data-donate-close], [data-admin-close]"
  ).forEach(btn => {
    btn.addEventListener("click", () => {
      const overlay = btn.closest("[data-open]");
      if (overlay) (overlay as HTMLElement).dataset.open = "false";
    });
  });

  document.querySelectorAll(
    ".report-overlay__backdrop, .about-overlay__backdrop, .auth-backdrop, .support-backdrop, .donate-backdrop, .admin-backdrop"
  ).forEach(el => {
    el.addEventListener("click", () => {
      const overlay = el.closest("[data-open]");
      if (overlay) (overlay as HTMLElement).dataset.open = "false";
    });
  });
}

// ============================================================
// KEYBOARD
// ============================================================
function setupKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll("[data-open='true']").forEach(el => {
        (el as HTMLElement).dataset.open = "false";
      });
    }
  });
}

// ============================================================
// TOAST
// ============================================================
export function toast(opts: { text: string; kind?: "info" | "warn" | "ok" }) {
  const host = document.getElementById("toastHost");
  if (!host) return;

  const el = document.createElement("div");
  el.className = `toast toast--${opts.kind || "info"}`;
  el.textContent = opts.text;
  host.appendChild(el);

  setTimeout(() => {
    el.classList.add("toast--out");
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ============================================================
// CLOCK
// ============================================================
function updateClock() {
  const clock = document.getElementById("clock");
  if (!clock) return;

  const now = new Date();
  const kyiv = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
  clock.textContent = kyiv.toLocaleTimeString("uk-UA", { hour12: false });
}

setInterval(updateClock, 1000);
updateClock();

// ============================================================
// INIT
// ============================================================
async function init() {
  console.log("[UD] Initializing...");
  setupNavigation();
  setupKeyboard();

  await pollAlerts();
  startPolling();
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
