export type ConfigurationValue = string | number | boolean;
export interface ConfigurationDefinition {
  key: string;
  group: string;
  title: string;
  description: string;
  type: "text" | "number" | "boolean" | "select";
  defaultValue: ConfigurationValue;
  min?: number;
  max?: number;
  maxLength?: number;
  integer?: boolean;
  step?: number;
  options?: string[];
  effect: "new_task" | "next_request";
}
export interface ConfigurationSnapshot {
  revision: number;
  values: Record<string, ConfigurationValue>;
}
export interface ConfigurationItem extends ConfigurationDefinition {
  value: ConfigurationValue;
}
export interface ConfigurationView {
  revision: number;
  items: ConfigurationItem[];
}
export interface ConfigurationHistory {
  revision: number;
  value: ConfigurationValue;
  administratorId: string | null;
  note: string;
  createdAt: string;
}
