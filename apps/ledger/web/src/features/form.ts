export interface LedgerFormField {
  key: string;
  label: string;
  kind?:
    | "text"
    | "money"
    | "number"
    | "date"
    | "month"
    | "select"
    | "checkbox"
    | "textarea";
  required?: boolean;
  max?: number;
  options?: {
    value: string | number | boolean;
    label: string;
    disabled?: boolean;
  }[];
  hint?: string;
  clearable?: boolean;
}
export type FormValues = Record<string, string | number | boolean>;
