/** References identify domain records, not uploaded files and never grant access. */
export interface ResourceRef {
  appId: string;
  resourceType: string;
  resourceId: string;
}
export type { ApplicationManifest } from "./index.js";
export interface ApplicationDestination {
  appId: string;
  params?: Record<string, string>;
}
export function resourceKey(ref: ResourceRef): string {
  return JSON.stringify([ref.appId, ref.resourceType, ref.resourceId]);
}
export function uniqueResources(refs: readonly ResourceRef[]): ResourceRef[] {
  return [...new Map(refs.map((ref) => [resourceKey(ref), ref])).values()];
}
