export interface CategoryPreset {
  id: string;
  type: "income" | "expense";
  label: string;
  icon: string;
  active: boolean;
  sortOrder: number;
  revision: number;
  updatedAt: string;
}
