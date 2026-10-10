import { EntitySchema } from "typeorm";
import type { Bill, BillCategory } from "@t-box/ledger-contracts";
const id = { type: "char" as const, length: 36, primary: true };
const createdAt = {
  type: "datetime" as const,
  precision: 3,
  name: "created_at",
  default: () => "CURRENT_TIMESTAMP(3)",
};
export interface StoredBill extends Omit<Bill, "createdAt" | "updatedAt"> {
  ledgerId?: string;
  createdBy?: string | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export const BillEntity = new EntitySchema<StoredBill>({
  name: "Bill",
  tableName: "bills",
  columns: {
    id,
    ledgerId: {
      type: "char",
      length: 36,
      name: "ledger_id",
      default: "00000000-0000-4000-8000-000000000001",
    },
    createdBy: { type: "char", length: 36, name: "created_by", nullable: true },
    deletedAt: {
      type: "datetime",
      precision: 3,
      name: "deleted_at",
      nullable: true,
    },
    type: { type: "enum", enum: ["income", "expense"] },
    amount: { type: "decimal", precision: 11, scale: 2 },
    category: { type: "varchar", length: 36 },
    date: { type: "date", name: "bill_date" },
    note: { type: "varchar", length: 200, default: "" },
    createdAt,
    updatedAt: { type: "datetime", precision: 3, name: "updated_at" },
  },
  indices: [
    { name: "idx_bills_date_created", columns: ["date", "createdAt"] },
    { name: "idx_bills_type_date", columns: ["type", "date"] },
  ],
  checks: [{ name: "chk_bills_positive_amount", expression: "amount > 0" }],
  foreignKeys: [
    {
      name: "fk_bill_category_type",
      target: "BillCategory",
      columnNames: ["category", "type"],
      referencedColumnNames: ["id", "type"],
      onDelete: "RESTRICT",
    },
  ],
});
export const CategoryEntity = new EntitySchema<
  BillCategory & { ledgerId?: string; sortOrder?: number }
>({
  name: "BillCategory",
  tableName: "bill_categories",
  columns: {
    id: { type: "varchar", length: 36, primary: true },
    ledgerId: {
      type: "char",
      length: 36,
      name: "ledger_id",
      default: "00000000-0000-4000-8000-000000000001",
    },
    sortOrder: { type: Number, name: "sort_order", default: 0 },
    type: { type: "enum", enum: ["income", "expense"] },
    label: { type: "varchar", length: 40 },
    icon: { type: "varchar", length: 32, default: "other" },
    isDefault: { type: Boolean, name: "is_default", default: false },
  },
  uniques: [
    { name: "uq_book_category_label", columns: ["ledgerId", "type", "label"] },
    { name: "uq_category_id_type", columns: ["id", "type"] },
  ],
});
