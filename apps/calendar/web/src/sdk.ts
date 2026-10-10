import { createShellApplication } from "@t-box/app-shell-sdk";
/** App-bound common SDK; REST is a temporary trusted-module compatibility port. */
export const application = createShellApplication("calendar");
export const request = application.request;
export const applicationMutation = application.mutation;
