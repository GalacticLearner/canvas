/** Protocol limits are shared so the client cannot silently exceed server budgets. */
export const LIMITS = {
  maxFrame: 4 * 1024 * 1024,
  maxPoints: 20000,
  maxText: 5000,
  maxElements: 50000,
  maxCoord: 1e6,
  maxAsset: 8 * 1024 * 1024,
  assetChunk: 512 * 1024,
  softQueue: 8 * 1024 * 1024,
  hardQueue: 16 * 1024 * 1024,
} as const;
/** Versioned transport defaults. */
export const PROTOCOL = {
  version: 1,
  tcpPort: 5050,
  udpPort: 5051,
  heartbeat: 5000,
  timeout: 15000,
  grace: 120000,
} as const;
/** Distinct identities combine color with names; color is never the sole identifier. */
export const IDENTITY_COLORS = [
  "#0072B2",
  "#D55E00",
  "#009E73",
  "#CC79A7",
  "#8C6100",
  "#6C55A3",
  "#007C83",
  "#BA3655",
  "#576A12",
  "#8D522D",
  "#476BB5",
  "#865F83",
];
/** Stable public error vocabulary. */
export const ERROR_CODES = [
  "BAD_FRAME",
  "BAD_MSG",
  "UNSUPPORTED_VERSION",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "AUTH_REQUIRED",
  "AUTH_FAILED",
  "LOCKED_OUT",
  "BANNED",
  "DENIED",
  "USERNAME_TAKEN",
  "FORBIDDEN",
  "READ_ONLY",
  "RATE_LIMITED",
  "TOO_LARGE",
  "INVALID_OP",
  "TARGET_MISSING",
  "NOT_FOUND",
  "INTERNAL",
] as const;
/** Errors cross the wire by code rather than leaking internal stack traces. */
export class ProtocolError extends Error {
  constructor(
    public code: (typeof ERROR_CODES)[number],
    message: string,
  ) {
    super(message);
  }
}
/** Browser and Node both supply a cryptographic UUID implementation. */
export const newId = () => crypto.randomUUID();
