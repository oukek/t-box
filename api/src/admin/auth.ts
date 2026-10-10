import { randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { ApiError } from "@t-box/server-foundation/errors";
import { AdminStore } from "./store.js";
import { digest, hashPassword, verifyPassword } from "./crypto.js";
import { body, password, text, bad } from "./validation.js";

const unauthorized = () =>
  new ApiError(401, "UNAUTHENTICATED", "请登录后台管理");
export function sessionToken(request: FastifyRequest) {
  return (
    request.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("tbox_admin="))
      ?.slice(11) ?? ""
  );
}
export const cookie = (token: string, age = 28800) =>
  `tbox_admin=${token}; Path=/api/v1/admin; HttpOnly; SameSite=Strict; Max-Age=${age}${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
export class AdminAuth {
  private readonly attempts = new Map<
    string,
    { count: number; expires: number }
  >();
  private readonly dummy = hashPassword(randomBytes(32).toString("hex"));
  constructor(readonly store: AdminStore) {}
  async login(value: unknown, ip: string) {
    const input = body(value, ["username", "password"]);
    const username = text(input.username, "账号", 64);
    if (
      typeof input.password !== "string" ||
      !input.password ||
      input.password.length > 128
    )
      bad("密码格式无效");
    const secret = input.password;
    const now = Date.now();
    for (const [key, entry] of this.attempts)
      if (entry.expires < now) this.attempts.delete(key);
    const key = digest(ip);
    const entry = this.attempts.get(key) ?? {
      count: 0,
      expires: now + 15 * 60_000,
    };
    if (++entry.count > 20 || this.attempts.size > 5000)
      throw new ApiError(429, "LOGIN_LIMIT", "尝试次数过多，请 15 分钟后重试");
    this.attempts.set(key, entry);
    const result = await this.store.transaction(async (db) => {
      const [user] = await db.rows<{
        id: string;
        password_hash: string;
        enabled: number;
        locked: number;
      }>(
        "SELECT id,password_hash,enabled,(locked_until > UTC_TIMESTAMP(3)) AS locked FROM admin_users WHERE username=? FOR UPDATE",
        [username]
      );
      const valid = await verifyPassword(
        secret,
        user?.password_hash ?? (await this.dummy)
      );
      if (!user || !valid || !user.enabled || user.locked) {
        if (user && !user.locked)
          await db.execute(
            "UPDATE admin_users SET failed_attempts=failed_attempts+1, locked_until=IF(failed_attempts>=5,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE),NULL) WHERE id=?",
            [user.id]
          );
        return null;
      }
      await db.execute(
        "UPDATE admin_users SET failed_attempts=0,locked_until=NULL WHERE id=?",
        [user.id]
      );
      const token = randomBytes(32).toString("hex");
      await db.execute(
        "INSERT INTO admin_sessions (token_hash,admin_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 8 HOUR))",
        [digest(token), user.id]
      );
      return { token, user: { id: user.id, username } };
    });
    if (!result)
      throw new ApiError(
        401,
        "LOGIN_FAILED",
        "账号或密码不正确，或账号已被锁定"
      );
    await this.store.execute(
      "DELETE FROM admin_sessions WHERE expires_at < UTC_TIMESTAMP(3)"
    );
    return result;
  }

  async authenticate(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw unauthorized();
    const [user] = await this.store.rows<{ id: string; username: string }>(
      "SELECT u.id,u.username FROM admin_sessions s JOIN admin_users u ON u.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3) AND u.enabled=TRUE",
      [digest(token)]
    );
    if (!user) throw unauthorized();
    return user;
  }
  async logout(token: string) {
    await this.store.execute("DELETE FROM admin_sessions WHERE token_hash=?", [
      digest(token),
    ]);
  }
  async setUserEnabled(id: string, active: boolean) {
    await this.store.transaction(async (db) => {
      // Consistent locking prevents concurrent changes from disabling every admin.
      const users = await db.rows<{ id: string; enabled: number }>(
        "SELECT id,enabled FROM admin_users ORDER BY id FOR UPDATE"
      );
      if (!users.some((user) => user.id === id))
        throw new ApiError(404, "ADMIN_NOT_FOUND", "管理员不存在");
      if (!active && !users.some((user) => user.id !== id && user.enabled))
        bad("至少保留一个启用的管理员");
      await db.execute("UPDATE admin_users SET enabled=? WHERE id=?", [
        active,
        id,
      ]);
      if (!active)
        await db.execute("DELETE FROM admin_sessions WHERE admin_id=?", [id]);
    });
  }
  async changePassword(id: string, value: unknown) {
    const input = body(value, ["currentPassword", "newPassword"]);
    const newHash = await hashPassword(password(input.newPassword));
    await this.store.transaction(async (db) => {
      const [user] = await db.rows<{ password_hash: string }>(
        "SELECT password_hash FROM admin_users WHERE id=? FOR UPDATE",
        [id]
      );
      if (
        !user ||
        typeof input.currentPassword !== "string" ||
        input.currentPassword.length > 128 ||
        !(await verifyPassword(input.currentPassword, user.password_hash))
      )
        bad("当前密码不正确");
      await db.execute(
        "UPDATE admin_users SET password_hash=?,failed_attempts=0,locked_until=NULL WHERE id=?",
        [newHash, id]
      );
      await db.execute("DELETE FROM admin_sessions WHERE admin_id=?", [id]);
    });
  }
}
