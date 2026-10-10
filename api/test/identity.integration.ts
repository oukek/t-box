import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDataSource } from "../src/db/data-source.js";
import { PlatformService } from "../src/platform/service.js";
import { createApp } from "../src/app.js";
import { cleanupUsers } from "./fixtures.js";
const source = await createDataSource().initialize(),
  p = new PlatformService(source),
  app = createApp({
    platform: p,
    bills: {} as any,
    logger: { level: "error" },
    health: async () => ({ mysql: "up", redis: "disabled" }),
  }),
  ids: string[] = [];
async function call(
  method: any,
  url: string,
  token = "",
  payload?: unknown,
  status = 200,
) {
  const reply = await app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as any }),
  });
  assert.equal(reply.statusCode, status, `${method} ${url}`);
  return reply.statusCode === 204 ? null : reply.json();
}
try {
  const users = [];
  for (let i = 0; i < 2; i++) {
    const session = (
      await call(
        "POST",
        "/api/v1/auth/register",
        "",
        {
          username: `test_profile_${randomUUID().replaceAll("-", "")}`,
          password: "test123",
          nickname: `测试${i}`,
        },
        201,
      )
    ).data;
    ids.push(session.user.id);
    assert.ok(Number.isFinite(Date.parse(session.user.createdAt)));
    assert.equal(
      new Date(session.user.createdAt).toISOString(),
      session.user.createdAt,
    );
    users.push(session);
  }
  const [a, b] = users;
  await call("PATCH", "/api/v1/auth/me", "", { nickname: "无权限" }, 401);
  const next = (
    await call("PATCH", "/api/v1/auth/me", a.token, {
      nickname: "  新昵称 🍀  ",
    })
  ).data;
  assert.equal(next.nickname, "新昵称 🍀");
  assert.equal(next.id, a.user.id);
  assert.equal(next.createdAt, a.user.createdAt);
  assert.equal(
    (await call("GET", "/api/v1/auth/me", a.token)).data.createdAt,
    a.user.createdAt,
  );
  assert.equal(
    (await call("GET", "/api/v1/auth/me", a.token)).data.nickname,
    "新昵称 🍀",
  );
  assert.equal(
    (await call("GET", "/api/v1/auth/me", b.token)).data.nickname,
    b.user.nickname,
  );
  for (const value of [
    { nickname: "" },
    { nickname: "  " },
    { nickname: "x".repeat(41) },
    { nickname: null },
    { nickname: 123 },
    { nickname: "越权", id: b.user.id },
    { nickname: "越权", username: b.user.username },
    { nickname: "越权", password: "test456" },
    {},
  ])
    await call("PATCH", "/api/v1/auth/me", a.token, value, 400);
  const boundary = "中".repeat(40);
  await call("PATCH", "/api/v1/auth/me", a.token, { nickname: boundary });
  assert.equal(
    (await call("GET", "/api/v1/auth/me", a.token)).data.nickname,
    boundary,
  );
  const session = (
    await call("POST", "/api/v1/auth/login", "", {
      username: a.user.username,
      password: "test123",
    })
  ).data;
  assert.equal(session.user.nickname, boundary);
  assert.equal(session.user.createdAt, a.user.createdAt);
  await call("DELETE", "/api/v1/auth/session", a.token, undefined, 204);
  await call("PATCH", "/api/v1/auth/me", a.token, { nickname: "撤销后" }, 401);
  assert.equal(
    (await call("GET", "/api/v1/auth/me", session.token)).data.nickname,
    boundary,
  );
  console.log(
    "Profile integration passed: persistence, isolation, validation and revoked sessions",
  );
} finally {
  await app.close();
  await cleanupUsers(source, ids);
  await source.destroy();
}
