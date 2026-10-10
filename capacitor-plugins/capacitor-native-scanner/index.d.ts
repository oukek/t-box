export type ScannerFormat =
  | 'aztec' |
  'code_128' |
  'code_39' |
  'code_93' |
  'data_matrix' |
  'ean_13' |
  'ean_8' |
  'itf' |
  'pdf_417' |
  'qr_code' |
  'upc_a' |
  'upc_e'

export interface ScanOptions {
  formats?: ScannerFormat[]
  torch?: boolean
}

export interface ScanResult {
  text: string
  format?: string
  cancelled?: boolean
}

export interface NativeScannerPlugin {
  scan(options?: ScanOptions): Promise<ScanResult>
  isSupported(): Promise<{ supported: boolean }>
}

export const NativeScanner: NativeScannerPlugin
