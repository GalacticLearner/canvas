/** Single wire catalog for both directions; all inbound data is parsed before dispatch. */
import { z } from "zod";
import { opSchema, boardSchema } from "./model";
import { ERROR_CODES, ProtocolError } from "./constants";
const str = z.string().max(100),
  text = z.string().max(5000),
  empty = z.object({}).strict(),
  seq = z.number().int(),
  role = z.enum(["owner", "editor", "viewer"]);
/** Room policy defaults are applied once at creation. */
export const settingsSchema = z
  .object({
    name: z.string().min(1).max(100),
    passwordProtected: z.boolean(),
    requireApproval: z.boolean(),
    defaultRole: z.enum(["editor", "viewer"]),
    editorsCanClear: z.boolean(),
    editorsCanPresent: z.boolean(),
    chatEnabled: z.boolean(),
    viewerChatMuted: z.boolean().default(false),
    boardLocked: z.boolean(),
    maxParticipants: z.number().int().min(2).max(100).default(50),
  })
  .strict();
/** Serializable room policy. */
export type Settings = z.infer<typeof settingsSchema>;
/** Initial room policy. */
export const defaultSettings: Settings = {
  name: "Untitled workspace",
  passwordProtected: false,
  requireApproval: false,
  defaultRole: "editor",
  editorsCanClear: false,
  editorsCanPresent: true,
  chatEnabled: true,
  viewerChatMuted: false,
  boardLocked: false,
  maxParticipants: 50,
};
/** Public participant identity excludes session secrets. */
export const participantSchema = z.object({
  id: str,
  username: z.string().min(1).max(24),
  role,
  color: str,
  status: z.enum(["online", "reconnecting"]),
});
/** Participant roster entry. */
export type Participant = z.infer<typeof participantSchema>;
const applied = z.object({
  seq,
  opId: str,
  by: str,
  op: opSchema,
  ts: z.number().optional(),
  byName: str.optional(),
});
const present = z.object({
  active: z.boolean(),
  presenterId: str.optional(),
  frameId: str.optional(),
  index: z.number().int().optional(),
});
const error = z.object({
  code: z.enum(ERROR_CODES),
  message: text,
  ref: str.optional(),
});
const chat = z.object({
  id: str,
  by: str,
  username: str,
  text: z.string().max(2000),
  ts: z.number(),
  system: z.boolean().optional(),
});
const snapMeta = z.object({
  id: str,
  label: z.string().max(100),
  by: str,
  ts: z.number(),
  elementCount: z.number(),
  thumb: z.string().max(200000).optional(),
  auto: z.boolean().optional(),
});
/** Payload schemas intentionally enumerate every message, including responses. */
export const catalog = {
  hello: z
    .object({
      clientId: str,
      app: str,
      appVersion: str,
      platform: str,
      identityColorHint: z
        .string()
        .regex(/^#[a-fA-F0-9]{6}$/)
        .optional(),
    })
    .strict(),
  hello_ack: z.object({
    serverId: str,
    serverName: str,
    serverTime: z.number(),
    hbIntervalMs: z.number(),
    hbTimeoutMs: z.number(),
    limits: z.record(z.string(), z.number()),
  }),
  ping: z.object({ n: z.number() }),
  pong: z.object({ n: z.number() }),
  room_create: z
    .object({
      name: z.string().min(1).max(100),
      username: z.string().min(1).max(24),
      password: z.string().max(200).optional(),
      settings: settingsSchema.partial().optional(),
    })
    .strict(),
  room_join: z
    .object({
      code: z.string().regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/),
      username: z.string().min(1).max(24),
      resumeToken: str.optional(),
      ownerKey: str.optional(),
      lastSeq: seq.optional(),
    })
    .strict(),
  auth_challenge: z.object({
    salt: str,
    nonce: str,
    kdf: z.object({ N: z.number(), r: z.number(), p: z.number() }),
  }),
  auth_proof: z.object({ proof: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  join_pending: empty,
  join_request: z.object({ pendingId: str, username: str }),
  join_decide: z.object({ pendingId: str, allow: z.boolean() }).strict(),
  join_ok: z.object({
    code: str,
    you: participantSchema,
    participants: z.array(participantSchema),
    settings: settingsSchema,
    seq,
    mode: z.enum(["snapshot", "delta"]),
    snapshot: boardSchema.optional(),
    ops: z.array(applied).optional(),
    chat: z.array(chat),
    present,
    resumeToken: str,
    ownerKey: str.optional(),
  }),
  join_denied: error,
  room_leave: empty,
  participant_joined: z.object({ participant: participantSchema }),
  participant_left: z.object({ participant: participantSchema }),
  participant_updated: z.object({ participant: participantSchema }),
  role_set: z
    .object({ userId: str, role: z.enum(["editor", "viewer"]) })
    .strict(),
  kick: z.object({ userId: str, ban: z.boolean().optional() }).strict(),
  owner_transfer: z.object({ userId: str }).strict(),
  settings_update: z
    .object({
      patch: settingsSchema
        .partial()
        .extend({ password: z.string().max(200).optional() }),
    })
    .strict(),
  settings_changed: z.object({ settings: settingsSchema }),
  op: z.object({ opId: str, op: opSchema }).strict(),
  op_applied: applied,
  op_rejected: z.object({
    opId: str,
    code: z.enum(ERROR_CODES),
    message: text,
  }),
  eph: z
    .object({
      k: z.enum([
        "cursor",
        "stroke_preview",
        "shape_preview",
        "drag_preview",
        "typing",
        "editing",
        "viewport",
        "laser",
      ]),
      by: str.optional(),
      d: z.record(z.string(), z.unknown()),
    })
    .strict(),
  sync_req: z.object({ fromSeq: seq }).strict(),
  sync_delta: z.object({ fromSeq: seq, toSeq: seq, ops: z.array(applied) }),
  sync_snapshot: z.object({ seq, snapshot: boardSchema }),
  checkpoint: z.object({ seq, hash: str, count: z.number() }),
  chat_send: z.object({ cid: str, text: z.string().min(1).max(2000) }).strict(),
  chat_msg: chat,
  snap_save: z
    .object({
      label: z.string().min(1).max(100),
      thumb: z.string().max(200000).optional(),
    })
    .strict(),
  snap_list: empty,
  snap_get: z.object({ id: str }),
  snap_restore: z.object({ id: str }),
  snap_delete: z.object({ id: str }),
  snap_list_result: z.object({ snapshots: z.array(snapMeta) }),
  snap_data: z.object({ id: str, state: boardSchema }),
  snap_changed: empty,
  asset_have: z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) }),
  asset_have_result: z.object({ hash: str, have: z.boolean() }),
  asset_put: z
    .object({
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
      size: z.number().int().positive().max(8388608),
      idx: z.number().int().min(0).max(15),
      total: z.number().int().min(1).max(16),
      data: z.string().max(699052),
    })
    .strict(),
  asset_put_ok: z.object({ hash: str }),
  asset_get: z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) }),
  asset_chunk: z.object({
    hash: str,
    mime: str,
    idx: z.number(),
    total: z.number(),
    data: z.string().max(699052),
  }),
  present_set: present,
  present_state: present,
  error,
  bye: z.object({ reason: text }),
} as const;
/** Generic envelope is narrowed at dispatch using the catalog's type key. */
export interface Envelope {
  v: 1;
  t: keyof typeof catalog;
  id?: string;
  rid?: string;
  ts?: number;
  p: any;
}
/** Parse both the bounded envelope and its known payload. */
export function parseEnvelope(value: unknown): Envelope {
  // Guard recursive validators before invoking them: a frame can be small yet deeply nested.
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (item.depth > 24 || ++count > 450000)
      throw new ProtocolError(
        "BAD_MSG",
        "Message nesting or collection budget exceeded",
      );
    if (item.value && typeof item.value === "object")
      for (const child of Object.values(item.value))
        stack.push({ value: child, depth: item.depth + 1 });
  }
  const env = z
    .object({
      v: z.number(),
      t: z.string(),
      id: str.optional(),
      rid: str.optional(),
      ts: z.number().optional(),
      p: z.unknown(),
    })
    .strict()
    .parse(value);
  if (env.v !== 1)
    throw new ProtocolError(
      "UNSUPPORTED_VERSION",
      "Protocol version 1 required",
    );
  if (!Object.hasOwn(catalog, env.t))
    throw new ProtocolError("BAD_MSG", "Unknown message type");
  const t = env.t as keyof typeof catalog;
  return { ...env, v: 1, t, p: catalog[t].parse(env.p) };
}
/** Build messages with compile-time payload inference. */
export function msg<K extends keyof typeof catalog>(
  t: K,
  p: z.input<(typeof catalog)[K]>,
  extras: Partial<Pick<Envelope, "id" | "rid" | "ts">> = {},
): Envelope {
  return { v: 1, t, p, ...extras };
}
