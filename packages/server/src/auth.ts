/** Password verification uses scrypt plus a one-time challenge, never a join plaintext password. */
import {
  scryptSync,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
/** Persisted verifier is sensitive and remains exclusively on the server. */
export interface PasswordRecord {
  salt: string;
  key: string;
}
/** Create/change passwords only while handling an owner-authorized request. */
export function passwordRecord(password: string): PasswordRecord {
  const salt = randomBytes(16).toString("hex");
  return {
    salt,
    key: scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString(
      "hex",
    ),
  };
}
/** Single-use nonce prevents reusing a captured proof on another connection. */
export const nonce = () => randomBytes(24).toString("hex");
/** Constant-time comparison rejects malformed lengths before calling timingSafeEqual. */
export function verifyProof(
  record: PasswordRecord,
  challenge: string,
  proof: string,
) {
  const expected = createHmac("sha256", Buffer.from(record.key, "hex"))
    .update(challenge)
    .digest();
  const actual = Buffer.from(proof, "hex");
  return actual.length === expected.length && timingSafeEqual(expected, actual);
}
