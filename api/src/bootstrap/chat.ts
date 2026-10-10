import { bindInstalledCapabilities } from "../application-platform/capabilities.js";
import {
  ChatService,
  type ChatServiceOptions as RuntimeOptions,
} from "../chat/engine.js";
import type { PlatformService } from "../platform/service.js";
import type { BillRepository } from "@t-box/ledger-server/repository";
import type { CategoryRepository } from "@t-box/ledger-server/categories/repository";
import type { ApplicationModule } from "../agent/contracts.js";
import { CapabilityRegistry } from "../agent/registry.js";
import { createShellModule } from "../agent/builtins.js";
import { createApplicationModules } from "../applications/registry.js";
import { adaptApplication } from "./application-adapter.js";
import { attachmentPort } from "../resources/chat.js";
export interface ChatServiceOptions extends Omit<
  RuntimeOptions,
  "registry" | "host"
> {
  platform?: PlatformService;
  bills: BillRepository;
  categories?: CategoryRepository;
  modules?: ApplicationModule[];
}
/** Composition root only: the runtime never imports individual applications or services. */
export function createCapabilities(
  options: Pick<
    ChatServiceOptions,
    "platform" | "bills" | "categories" | "modules"
  >,
) {
  const modules = [
    ...createApplicationModules(options).map(adaptApplication),
    ...(options.modules || []),
  ].map((module) =>
    bindInstalledCapabilities(module, options.platform?.applications),
  );
  return new CapabilityRegistry([...modules, createShellModule(modules)]);
}
export class ApplicationChatService extends ChatService {
  constructor(options: ChatServiceOptions) {
    const {
      platform,
      provider,
      sessions,
      runTimeoutMs,
      clientToolTimeoutMs,
      maxToolRounds,
      workflow,
      configuration,
      onRunError,
    } = options;
    const registry = createCapabilities(options);
    platform?.conversations?.setAccess?.(registry.access);
    super({
      provider,
      sessions,
      runTimeoutMs,
      clientToolTimeoutMs,
      maxToolRounds,
      workflow,
      configuration,
      onRunError,
      registry,
      host: platform
        ? {
            identity: platform.identity,
            tasks: platform.tasks,
            conversations: platform.conversations,
            attachments: platform.resources
              ? attachmentPort(platform.resources)
              : undefined,
          }
        : undefined,
    });
  }
}
