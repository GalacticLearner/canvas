/** Room authority contains membership, deterministic board state and bounded recovery history. */
import { randomBytes } from "node:crypto";
import {
  emptyBoard,
  defaultSettings,
  type Settings,
  type Participant,
  type BoardState,
  type Envelope,
  type Op,
} from "../../shared/src/index";
import type { Connection } from "./connection";
import type { PasswordRecord } from "./auth";
/** Secrets are stored separately from public participant records. */
export interface Session {
  participant: Participant;
  token: string;
  clientId: string;
  ip: string;
  connection?: Connection;
  expires?: number;
}
/** Retained operations carry the exact authority context needed by replicas. */
export interface Applied {
  seq: number;
  opId: string;
  by: string;
  byName: string;
  ts: number;
  op: Op;
}
/** Named versions contain immutable board snapshots and UI metadata. */
export interface Snapshot {
  id: string;
  label: string;
  by: string;
  ts: number;
  elementCount: number;
  thumb?: string;
  auto: boolean;
  state?: BoardState;
}
/** One event loop serializes accepted ops; no asynchronous gap occurs between validation and commit. */
export class Room {
  state = emptyBoard();
  settings: Settings;
  ownerKey = randomBytes(32).toString("hex");
  password?: PasswordRecord;
  sessions = new Map<string, Session>();
  ops: Applied[] = [];
  dedup = new Map<string, Applied>();
  chat: any[] = [];
  chatIds = new Set<string>();
  snapshots: Snapshot[] = [];
  bans: { clientId: string; ip: string }[] = [];
  present: any = { active: false };
  lastActive = Date.now();
  lastSavedSeq = -1;
  dirty = false;
  locks = new Map<string, { by: string; until: number }>();
  constructor(
    public code: string,
    name: string,
  ) {
    this.settings = { ...defaultSettings, name };
  }
  /** Public roster strips credentials and detached sockets. */
  roster() {
    return [...this.sessions.values()].map((s) => s.participant);
  }
  /** Broadcast includes the sender for authoritative acknowledgements. */
  broadcast(e: Envelope, except?: string) {
    for (const s of this.sessions.values())
      if (s.participant.id !== except) s.connection?.send(e);
  }
  /** Validate a resume token without ever placing it in the roster. */
  sessionByToken(token: string) {
    return [...this.sessions.values()].find((s) => s.token === token);
  }
}
