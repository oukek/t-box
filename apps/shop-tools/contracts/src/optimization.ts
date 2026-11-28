import type { CatalogContent } from './catalog.js'

export type OptimizationMode = 'optimize' | 'keep' | 'remove'
export interface CatalogMedia { id: string, skuId: string | null, position: number, url: string, fileId?: string }
export interface ProjectPrompt { language: string, prompt: string, revision: number }
export interface OptimizationSlot { id: string, kind: 'text' | 'image', label: string, skuId: string | null, position: number, text?: string, asset?: CatalogMedia, mode: OptimizationMode }
export interface OptimizationResult { status: 'pending' | 'running' | 'complete' | 'failed', text?: string, fileId?: string, error?: string }
export interface OptimizationSnapshot { source: CatalogContent, sourceVersion: string, sourceRevision: number, country: string, currency: string, rules: ProjectPrompt, supplement: string, slots: OptimizationSlot[] }
export interface OptimizationJob { id: string, project: string, subject: string, product: string, snapshot: OptimizationSnapshot, results: Record<string, OptimizationResult>, status: 'running' | 'finished', lease: string, updatedAt: string, createdAt: string, appliedVersion: string | null }
export interface OptimizationModelInput { snapshot: OptimizationSnapshot, slots: OptimizationSlot[] }
