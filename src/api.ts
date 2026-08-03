// ============================================================
// Ukraine Defender — api.ts (FINAL)
// Data-запити: напряму, без кастомних заголовків, з ретраєм.
// Auth-запити: через apiFetch з Bearer token.
// ============================================================

import type {
  AlertResponse,
  NightResponse,
  AuthUser,
  AuthResponse,
  MeResponse,
  RegisterPayload,
  LoginPayload,
  ProfilePatch,
  PasswordForgotPayload,
  PasswordForgotResponse,
  PasswordResetPayload,
  SupportTicketDetailResponse,
  SupportTicketListResponse,
  CreateSupportTicketPayload,
  AdminUsersResponse,
  AdminTicketListResponse,
  AdminAnalyticsResponse,
  AdminLogsResponse,
  AdminSourceStatusResponse,
  AdminEventReportsResponse,
  CreateEventReportPayload,
  AdminSettingsResponse,
  PublicSettingsResponse,
  PublicSourceStatusResponse,
  AdminChannelUpdatePayload,
  HealthResponse,
  UserRole,
  SupportTicketStatus,
  EventReportStatus,
  EventsResponse,
  PostsResponse
} from "./types";

// ============================================================
// ENDPOINTS
// ============================================================

export const DATA_API_BASE =
  "https://ukraine-defender-data.shushko-art.workers.dev";

export const AUTH_API_BASE =
  "https://ukraine-defender-api.shushko-art.workers.dev";

const TOKEN_KEY = "ud_token";

export const DONATION_FALLBACK =
  "https://send.monobank.ua/jar/4tGSchYaiH";

// ============================================================
// ERROR
// ============================================================

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

// ============================================================
// TOKEN
// ============================================================

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

// ============================================================
// ROLE HELPERS
// ============================================================

export function isStaffRole(role?: string | null): boolean {
  return !!role && ["support", "admin", "owner"].includes(role);
}

export function isAdminRole(role?: string | null): boolean {
  return !!role && ["admin", "owner"].includes(role);
}

export function isOwnerRole(role?: string | null): boolean {
  return role === "owner";
}

// ============================================================
// DATA FETCH (DIRECT, NO CUSTOM HEADERS, WITH RETRY)
// ============================================================

async function fetchJsonDirect<T>(
  url: string,
  timeoutMs: number,
  tries = 2
): Promise<T> {
  let lastError: unknown = null;

  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      // ВАЖЛИВО: ніяких кастомних заголовків → простий GET → без preflight.
      const res = await fetch(url, { signal: ctrl.signal });

      if (!res.ok) {
        throw new ApiError(`HTTP ${res.status}`, res.status, null);
      }

      const data = (await res.json()) as T;

      return data;
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(t);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

// ============================================================
// DATA / MAP / EVENTS (DATA WORKER)
// ============================================================

export async function fetchHealth(): Promise<HealthResponse> {
  return fetchJsonDirect<HealthResponse>(
    `${DATA_API_BASE}/api/health`,
    10000
  );
}

export async function fetchAlerts(): Promise<AlertResponse> {
  const data = await fetchJsonDirect<AlertResponse>(
    `${DATA_API_BASE}/api/alerts`,
    20000,
    2
  );

  if (!data || !Array.isArray(data.regions)) {
    throw new Error("alerts: bad response shape");
  }

  return data;
}

export async function fetchEvents(
  region: string = "kyiv"
): Promise<EventsResponse> {
  const data = await fetchJsonDirect<EventsResponse>(
    `${DATA_API_BASE}/api/events?region=${encodeURIComponent(region)}`,
    25000,
    2
  );

  if (!data || !Array.isArray(data.events)) {
    throw new Error("events: bad response shape");
  }

  return data;
}

export async function fetchPosts(
  channel: string
): Promise<PostsResponse> {
  return fetchJsonDirect<PostsResponse>(
    `${DATA_API_BASE}/api/posts?channel=${encodeURIComponent(channel)}`,
    20000
  );
}

export async function fetchNight(
  hours: number = 12
): Promise<NightResponse> {
  return fetchJsonDirect<NightResponse>(
    `${DATA_API_BASE}/api/night?hours=${hours}`,
    25000
  );
}

// ============================================================
// AUTH FETCH CORE (AUTH WORKER)
// ============================================================

type QueryValue = string | number | boolean | null | undefined;
type QueryParams = Record<string, QueryValue>;

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: QueryParams;
  auth?: boolean;
  timeoutMs?: number;
}

function buildAuthUrl(path: string, query?: QueryParams): string {
  const base = AUTH_API_BASE.replace(/\/+$/, "");
  const url = new URL(`${base}${path}`, window.location.origin);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 20000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const token = getToken();

  if (token && options.auth !== false) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const method =
    options.method ?? (options.body !== undefined ? "POST" : "GET");

  try {
    const res = await fetch(buildAuthUrl(path, options.query), {
      method,
      headers,
      body:
        options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
      signal: controller.signal
    });

    if (res.status === 204) {
      return undefined as T;
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (
        res.status === 401 &&
        token &&
        !path.startsWith("/api/auth")
      ) {
        window.dispatchEvent(new CustomEvent("ud:unauthorized"));
      }

      const message =
        (data as any)?.error ||
        (data as any)?.message ||
        `HTTP ${res.status}`;

      throw new ApiError(String(message), res.status, data);
    }

    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// AUTH (AUTH WORKER)
// ============================================================

export function registerUser(
  payload: RegisterPayload
): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: payload
  });
}

export function loginUser(payload: LoginPayload): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: payload
  });
}

export function logoutUser(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/auth/logout", {
    method: "POST"
  });
}

export function fetchMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/api/auth/me");
}

export function updateProfile(
  patch: ProfilePatch
): Promise<{ ok: boolean; user: AuthUser }> {
  return apiFetch<{ ok: boolean; user: AuthUser }>(
    "/api/auth/profile",
    { method: "PATCH", body: patch }
  );
}

export function forgotPassword(
  payload: PasswordForgotPayload
): Promise<PasswordForgotResponse> {
  return apiFetch<PasswordForgotResponse>(
    "/api/auth/password/forgot",
    { method: "POST", body: payload }
  );
}

export function resetPassword(
  payload: PasswordResetPayload
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/auth/password/reset", {
    method: "POST",
    body: payload
  });
}

// ============================================================
// PUBLIC SETTINGS / SOURCE STATUS
// ============================================================

export function fetchPublicSettings(): Promise<PublicSettingsResponse> {
  return apiFetch<PublicSettingsResponse>("/api/settings/public", {
    timeoutMs: 10000
  });
}

export function fetchPublicSourceStatus(): Promise<PublicSourceStatusResponse> {
  return apiFetch<PublicSourceStatusResponse>("/api/source-status", {
    timeoutMs: 10000
  });
}

// ============================================================
// SUPPORT
// ============================================================

export function listSupportTickets(): Promise<SupportTicketListResponse> {
  return apiFetch<SupportTicketListResponse>("/api/support/tickets");
}

export function createSupportTicket(
  payload: CreateSupportTicketPayload
): Promise<{ ok: boolean; ticket_id: number }> {
  return apiFetch<{ ok: boolean; ticket_id: number }>(
    "/api/support/tickets",
    { method: "POST", body: payload }
  );
}

export function getSupportTicket(
  ticketId: number
): Promise<SupportTicketDetailResponse> {
  return apiFetch<SupportTicketDetailResponse>(
    `/api/support/tickets/${ticketId}`
  );
}

export function sendSupportMessage(
  ticketId: number,
  body: string
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(
    `/api/support/tickets/${ticketId}/messages`,
    { method: "POST", body: { body } }
  );
}

// ============================================================
// ADMIN / TICKETS
// ============================================================

export function listAdminTickets(
  status?: SupportTicketStatus | ""
): Promise<AdminTicketListResponse> {
  return apiFetch<AdminTicketListResponse>("/api/admin/tickets", {
    query: { status: status || undefined }
  });
}

export function sendAdminTicketMessage(
  ticketId: number,
  body: string
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(
    `/api/admin/tickets/${ticketId}/messages`,
    { method: "POST", body: { body } }
  );
}

export function closeAdminTicket(
  ticketId: number
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(
    `/api/admin/tickets/${ticketId}/close`,
    { method: "POST" }
  );
}

export function reopenAdminTicket(
  ticketId: number
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(
    `/api/admin/tickets/${ticketId}/reopen`,
    { method: "POST" }
  );
}

export function assignAdminTicket(
  ticketId: number,
  adminId: number
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(
    `/api/admin/tickets/${ticketId}/assign`,
    { method: "POST", body: { admin_id: adminId } }
  );
}

// ============================================================
// ADMIN / USERS
// ============================================================

export function listAdminUsers(): Promise<AdminUsersResponse> {
  return apiFetch<AdminUsersResponse>("/api/admin/users");
}

export function setUserRole(
  userId: number,
  role: UserRole
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/admin/users/${userId}/role`, {
    method: "POST",
    body: { role }
  });
}

export function setUserActive(
  userId: number,
  isActive: boolean
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(
    `/api/admin/users/${userId}/active`,
    { method: "POST", body: { is_active: isActive } }
  );
}

// ============================================================
// ADMIN / ANALYTICS / SOURCES / LOGS
// ============================================================

export function fetchAdminAnalyticsSummary(): Promise<AdminAnalyticsResponse> {
  return apiFetch<AdminAnalyticsResponse>("/api/admin/analytics/summary");
}

export function fetchAdminSourceStatus(): Promise<AdminSourceStatusResponse> {
  return apiFetch<AdminSourceStatusResponse>("/api/admin/source-status");
}

export function fetchAdminLogs(): Promise<AdminLogsResponse> {
  return apiFetch<AdminLogsResponse>("/api/admin/logs");
}

// ============================================================
// ADMIN / EVENT REPORTS
// ============================================================

export function fetchAdminEventReports(): Promise<AdminEventReportsResponse> {
  return apiFetch<AdminEventReportsResponse>("/api/admin/event-reports");
}

export function setAdminEventReportStatus(
  reportId: number,
  status: EventReportStatus
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(
    `/api/admin/event-reports/${reportId}/status`,
    { method: "POST", body: { status } }
  );
}

// ============================================================
// ADMIN / SETTINGS / CHANNELS
// ============================================================

export function fetchAdminSettings(): Promise<AdminSettingsResponse> {
  return apiFetch<AdminSettingsResponse>("/api/admin/settings");
}

export function updateAdminSetting(
  key: string,
  value: string
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/admin/settings", {
    method: "POST",
    body: { key, value }
  });
}

export function updateAdminChannel(
  payload: AdminChannelUpdatePayload
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/admin/channels", {
    method: "POST",
    body: payload
  });
}

// ============================================================
// USER EVENT REPORTS
// ============================================================

export function createEventReport(
  payload: CreateEventReportPayload
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/reports", {
    method: "POST",
    body: payload
  });
}

// ============================================================
// ANALYTICS
// ============================================================

export function trackAnalyticsEvent(
  name: string,
  props?: Record<string, unknown>
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/analytics/event", {
    method: "POST",
    body: { name, props: props ?? null },
    timeoutMs: 8000
  });
}
