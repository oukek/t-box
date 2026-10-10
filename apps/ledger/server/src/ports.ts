import type { EntityManager } from "typeorm";
import type { Principal } from "./ledgers/types.js";
export interface LedgerIdentityPort {
  authenticateHash(hash: string, db?: EntityManager): Promise<Principal>;
  authenticate(token: string): Promise<Principal>;
  limit(key: string, maximum?: number): void;
}

import type { LedgerServices } from "./ai/ports.js";
import type { LedgerService } from "./ledgers/service.js";
export interface LedgerRuntimeServices extends LedgerServices {
  ledgers: LedgerService;
  identity: LedgerIdentityPort;
  resources?: {
    createFile(
      actor: Principal,
      name: string,
      bytes: Buffer,
    ): Promise<{ id: string; name: string; mimeType: string; size: number }>;
    create(
      actor: Principal,
      name: string,
      bytes: Buffer,
    ): Promise<{ id: string; name: string; mimeType: string; size: number }>;
    get(
      actor: Principal,
      id: string,
    ): Promise<{ id: string; name: string; mimeType: string; size: number }>;
    readForApplication(
      id: string,
      authorize: () => Promise<unknown>,
    ): Promise<{
      resource: { id: string; name: string; mimeType: string; size: number };
      bytes: Buffer;
    }>;
  };
  applications?: {
    assertActive(userId: string, appId: string): Promise<unknown>;
  };
}
