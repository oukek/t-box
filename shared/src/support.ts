export interface CustomerSupportConfiguration {
  enabled: boolean;
  qrCodeUrl: string;
}

export interface AdminCustomerSupportConfiguration extends CustomerSupportConfiguration {
  updatedAt: string | null;
}
