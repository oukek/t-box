import { EntitySchema } from "typeorm";
import type { TimerState } from "@t-box/time-contracts";
export interface StoredTimer {
  id: string;
  userId: string;
  data: TimerState;
  revision: number;
  deleted: boolean;
  createdAt: Date;
}
export const TimerEntity = new EntitySchema<StoredTimer>({
  name: "AppTimer",
  tableName: "app_timers",
  columns: {
    id: { type: "char", length: 36, primary: true },
    userId: { type: "char", length: 36, name: "user_id" },
    data: { type: "json" },
    revision: { type: Number },
    deleted: { type: Boolean },
    createdAt: { type: "datetime", precision: 3, name: "created_at" },
  },
});
