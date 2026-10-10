import type { DataSource } from "typeorm";
import type {
  AdminCustomerSupportConfiguration,
  CustomerSupportConfiguration,
} from "@t-box/shared";
import { SupportSettingsEntity } from "./entity.js";
import { parseSupportConfiguration } from "./validation.js";
import type { ConfigurationCache } from "../configuration/cache.js";

export class CustomerSupportService {
  constructor(
    private readonly source: DataSource,
    private readonly cache?: ConfigurationCache,
  ) {}

  async configuration(): Promise<AdminCustomerSupportConfiguration> {
    if (this.cache)
      return this.cache.current(this.source, "support", () => this.load());
    return this.load();
  }
  private async load(): Promise<AdminCustomerSupportConfiguration> {
    const row = await this.source
      .getRepository(SupportSettingsEntity)
      .findOneBy({ id: 1 });
    return {
      enabled: row?.enabled ?? false,
      qrCodeUrl: row?.qrCodeUrl ?? "",
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async publicConfiguration(): Promise<CustomerSupportConfiguration> {
    const config = await this.configuration();
    return {
      enabled: config.enabled,
      qrCodeUrl: config.enabled ? config.qrCodeUrl : "",
    };
  }

  async save(value: unknown, administratorId: string) {
    const config = parseSupportConfiguration(value);
    const update = async (source: Pick<DataSource, "getRepository">) =>
      source.getRepository(SupportSettingsEntity).save({
        id: 1,
        ...config,
        updatedBy: administratorId,
        updatedAt: new Date(),
      });
    if (this.cache)
      await this.source.transaction(async (db) => {
        await update(db);
        await db.query(
          "UPDATE platform_configuration_state SET revision=revision+1 WHERE id=1",
        );
      });
    else await update(this.source);
    return this.configuration();
  }
}
