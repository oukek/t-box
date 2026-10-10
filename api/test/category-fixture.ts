import { randomUUID } from "node:crypto";
import type { BillCategory } from "@t-box/shared";
import type { CategoryRepository } from "@t-box/ledger-server/categories/repository";
import { invalid } from "@t-box/server-foundation/errors";
export function fakeCategories(): CategoryRepository {
  const categories: BillCategory[] = [
    {
      id: "food",
      label: "餐饮",
      type: "expense",
      icon: "food",
      isDefault: true,
    },
    {
      id: "salary",
      label: "工资",
      type: "income",
      icon: "salary",
      isDefault: true,
    },
    {
      id: "bonus",
      label: "奖金",
      type: "income",
      icon: "bonus",
      isDefault: true,
    },
    {
      id: "expense_other",
      label: "其他支出",
      type: "expense",
      icon: "other",
      isDefault: true,
    },
    {
      id: "income_other",
      label: "其他收入",
      type: "income",
      icon: "other",
      isDefault: true,
    },
  ];
  return {
    list: async () => categories,
    create: async (input) => {
      const row = {
        id: randomUUID(),
        ...input,
        icon: input.icon ?? "other",
        isDefault: false,
      };
      categories.push(row);
      return row;
    },
    validate: async (input) => {
      if (
        !categories.some(
          (c) => c.id === input.category && c.type === input.type
        )
      )
        invalid("category", "分类与收支类型不匹配");
    },
  };
}
