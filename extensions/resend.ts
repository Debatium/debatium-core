import { Resend } from "resend";
import type { AppConfig } from "../config.js";

let resendClient: Resend | null = null;

export function initResend(config: AppConfig): void {
  if (config.resendApiKey) {
    resendClient = new Resend(config.resendApiKey);
  }
}

export function getResend(): Resend {
  if (!resendClient) {
    throw new Error("Resend client not initialized. Set RESEND_API_KEY in .env");
  }
  return resendClient;
}
