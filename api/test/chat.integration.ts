import { FixtureChatProvider } from "./chat-provider-fixture.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createDataSource } from "../src/db/data-source.js";
import { createApp } from "../src/app.js";
import { PlatformService } from "../src/platform/service.js";
import { createBillRepository } from "@t-box/ledger-server/repository";
import { createCategoryRepository } from "@t-box/ledger-server/categories/repository";
import { cleanupUsers } from "./fixtures.js";
const source = await createDataSource().initialize(),
  p = new PlatformService(source),
  users: string[] = [];
const app = createApp({
  chatProvider: new FixtureChatProvider(),
  platform: p,
  bills: createBillRepository(source),
  categories: createCategoryRepository(source),
  health: async () => ({ mysql: "up", redis: "disabled" }),
});
try {
  const session = await p.identity.register(
    { username: `ws_${randomUUID().replaceAll("-", "")}`, password: "test123" },
    "fixture",
  );
  users.push(session.user.id);
  const actor = await p.identity.authenticate(session.token),
    book = (await p.ledgers.list(actor))[0]!;
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const exit = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ["../scripts/test-chat.mjs"], {
      stdio: "inherit",
      env: {
        ...process.env,
        TBOX_TEST_API_URL: `${address}/api/v1`,
        TBOX_TEST_WS_URL: `${address.replace("http:", "ws:")}/api/v1/chat/ws`,
        TBOX_TEST_TOKEN: session.token,
        TBOX_TEST_LEDGER_ID: book.id,
      },
    });
    child.once("exit", resolve);
    child.once("error", reject);
  });
  if (exit !== 0) throw new Error("Chat integration checks failed");
} finally {
  await app.close();
  await cleanupUsers(source, users);
  await source.destroy();
}
