import type { AppUser, UserSession } from "@t-box/shared";
import { request, RequestError } from "../../core/network";
import {
  identity,
  setSession,
  restoreIdentity,
  restoreError,
} from "../../core/session";
export async function restoreSession() {
  if (!identity.token) {
    restoreIdentity(null);
    return;
  }
  try {
    restoreIdentity((await request<{ data: AppUser }>("/auth/me")).data);
  } catch (cause) {
    if (cause instanceof RequestError && cause.status === 401)
      restoreIdentity(null);
    else
      restoreError(
        cause instanceof Error ? cause.message : "账号服务暂时不可用",
      );
  }
}
export async function authenticate(
  mode: "login" | "register",
  input: { username: string; password: string; nickname?: string },
) {
  const { data } = await request<{ data: UserSession }>(`/auth/${mode}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  setSession(data);
}
export async function logout() {
  try {
    await request("/auth/session", { method: "DELETE" });
  } finally {
    setSession(null);
  }
}
export async function updateNickname(nickname: string) {
  const { data } = await request<{ data: AppUser }>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify({ nickname }),
  });
  restoreIdentity(data);
}
