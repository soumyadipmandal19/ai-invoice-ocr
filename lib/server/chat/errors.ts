import "server-only";

export type ChatErrorDetails = { code: "provider_daily_quota" | "provider_rate_limit"; retryAfterSeconds: number; resetAt?: string };
export class ChatModelError extends Error {
  status: number;
  details?: ChatErrorDetails;
  constructor(message: string, status = 503, details?: ChatErrorDetails) {
    super(message); this.name = "ChatModelError"; this.status = status; this.details = details;
  }
}
