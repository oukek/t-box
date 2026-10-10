import { EntitySchema, type EntitySchemaColumnOptions } from "typeorm";
const id: EntitySchemaColumnOptions = {
  type: "char",
  length: 36,
  primary: true,
};
const reference: EntitySchemaColumnOptions = { type: "char", length: 36 };
const created: EntitySchemaColumnOptions = {
  type: "datetime",
  precision: 3,
  default: () => "(UTC_TIMESTAMP(3))",
};
const secret: EntitySchemaColumnOptions = {
  type: "varchar",
  length: 200,
  select: false,
};
const amount: EntitySchemaColumnOptions = {
  type: "decimal",
  precision: 11,
  scale: 2,
};
const total: EntitySchemaColumnOptions = {
  type: "decimal",
  precision: 20,
  scale: 2,
  default: 0,
};
const kinds = [
  "income",
  "expense",
  "lend",
  "borrow",
  "collect",
  "repay",
  "correction",
];
const direction: EntitySchemaColumnOptions = {
  type: "enum",
  enum: ["receivable", "payable"],
};
const note: EntitySchemaColumnOptions = {
  type: "varchar",
  length: 200,
  default: "",
};
const date: EntitySchemaColumnOptions = { type: "date" };
const boolean: EntitySchemaColumnOptions = { type: Boolean, default: false };
const table = (
  name: string,
  tableName: string,
  columns: Record<string, EntitySchemaColumnOptions>,
) => new EntitySchema({ name, tableName, columns });
/** Explicit metadata mirrors the migrations. No schema synchronization is used. */
export const platformEntities = [
  table("AppUser", "app_users", {
    id,
    username: { type: "varchar", length: 64, unique: true },
    nickname: { type: "varchar", length: 40 },
    passwordHash: { ...secret, name: "password_hash" },
    enabled: { type: Boolean, default: true },
    failedAttempts: { type: Number, name: "failed_attempts", default: 0 },
    lockedUntil: {
      type: "datetime",
      precision: 3,
      name: "locked_until",
      nullable: true,
    },
    createdAt: { ...created, name: "created_at" },
  }),
  table("UserSession", "user_sessions", {
    tokenHash: {
      type: "char",
      length: 64,
      name: "token_hash",
      primary: true,
      select: false,
    },
    userId: { ...reference, name: "user_id" },
    expiresAt: { type: "datetime", precision: 3, name: "expires_at" },
  }),
];
