# LAN Collaborative Whiteboard — Agent Build Plan

> **Audience:** an autonomous coding agent working in an empty repo with a shell, file access and (during development only) internet access.
> **Goal:** deliver a complete, standalone, LAN-only, multi-user collaborative whiteboard (server + client executables, source code with comments) that meets every mandatory requirement of the CN Lab assignment **and** implements every listed additional feature.
> **Out of scope:** the PDF technical documentation, the PPT, and the explanation video. Do not write them. (Keep code comments and `PROTOCOL` constants clean so those can be written later.)
> **Hard deadline of the human:** 15 Nov 2026. Work in the phase order below; Phases 0–7 yield a fully compliant mandatory build, Phases 8–12 add extras, hardening and packaging.

---

## 0. Agent operating rules (read first, obey always)

1. **Never stop to ask questions.** Every decision is already made in this plan. If something is ambiguous, pick the simplest option consistent with the plan, log it in `DECISIONS.md`, and continue.
2. **Progress tracking.** In Phase 0 create `PROGRESS.md`: copy every phase and step ID from this file as a checklist (`- [ ] P3-S2 Op pipeline`). Tick a step **only** when its *Accept* criteria pass. After each step: commit with message `P<phase>-S<step>: <title>`. After each phase: run the phase **Gate**, tick it, and `git tag phase-<n>-done`.
3. **Definition of done for any step:** `npm run typecheck`, `npm run lint`, and `npm test` are green; new logic has tests; no `TODO` left without an entry in `BLOCKERS.md`.
4. **Blocked?** Write the blocker in `BLOCKERS.md` (what, why, what you tried), skip to the next independent step, return later. Never fake a passing test.
5. **Runtime must be 100 % offline.** No CDN, no remote fonts, no telemetry, no update checks, no `fetch` to external hosts. Internet is allowed only to `npm install`/build. Every font and icon is bundled.
6. **Comments are graded.** Every source file starts with a header comment (purpose, responsibilities, how it fits). Every exported function/class/type has JSDoc. Non-obvious logic (ordering, dedup, undo conflict rules, backpressure) gets inline explanation. Comment *why*, not just *what*.
7. **One source of truth for the protocol:** `packages/shared`. Server and client import types, zod schemas, framing, and the reducer from there. Never duplicate message shapes.
8. **Design work must use the `impeccable` skill** (see Phase 5 and Phase 11). Do not hand-roll visual design without it. Do not use default-looking AI aesthetics (purple/blue gradients, generic Inter-everywhere, glass-blur everything, nested cards, emoji as icons).
9. Keep a `DECISIONS.md` (dated bullets) and `BLOCKERS.md`. Keep `PROGRESS.md` current — the human monitors it.
10. Prefer boring, well-known libraries. Pin versions via lockfile. Record any added dependency + license in `DECISIONS.md`.

---

## 1. Fixed technical decisions

| Concern | Decision |
|---|---|
| Language | TypeScript everywhere (strict mode) |
| Runtime | Node.js 22 LTS (`.nvmrc`) |
| Monorepo | npm workspaces: `packages/shared`, `packages/server`, `packages/client`, plus `tools/` |
| Transport | **Raw TCP sockets** (Node `net`), `setNoDelay(true)`, TCP keep-alive. *No WebSocket, no HTTP.* Justification: assignment mandates socket programming; TCP gives reliable in-order byte stream, we add framing and app-level recovery. |
| LAN discovery (extra) | UDP broadcast on port **5051** (discovery only; all board traffic is TCP) |
| Default ports | TCP **5050**, UDP **5051** (configurable) |
| Server | Node CLI app, bundled with esbuild → single file → `@yao-pkg/pkg` standalone executables |
| Client | **Electron** (current stable at install time) + Vite + React + TypeScript. The **TCP socket lives in the Electron main process** (`net.Socket`); renderer talks to it via `contextBridge` IPC. |
| Rendering | HTML5 Canvas 2D, two layers (static + dynamic overlay) + DOM overlays for text editing |
| State (renderer) | Zustand stores + a custom `SyncEngine` |
| Validation | `zod` (shared) |
| Ordering of z | `fractional-indexing` strings |
| Spatial index | `rbush` |
| PDF export | `jspdf` (offline) |
| Icons | `lucide-react` (bundled) |
| Fonts | Chosen by impeccable in Phase 5, **bundled** via `@fontsource-variable/*` or local woff2, OFL-licensed |
| Tests | `vitest` (unit/integration), `@playwright/test` with Electron for E2E smoke |
| Packaging | `electron-builder` (client), `@yao-pkg/pkg` (server), GitHub Actions matrix for native builds |
| Platforms | Windows x64 (primary, the demo OS is unknown — assume Windows), Linux x64, macOS (best effort) |
| IDs | `crypto.randomUUID()` (shortened base36 acceptable for element ids if sizes matter) |
| Time | Server stamps all authoritative timestamps (`ts`). Clients display in local time. |

### 1.1 Repo layout

```
lan-whiteboard/
  plan.md  PROGRESS.md  DECISIONS.md  BLOCKERS.md
  package.json  tsconfig.base.json  .nvmrc  eslint/prettier configs
  packages/
    shared/   src/{constants,errors,framing,protocol,schemas,model,reducer,undo,geometry,hash}.ts  (+ tests)
    server/   src/{main,config,logger,connection,rooms,room,auth,permissions,boardEngine,persistence,snapshots,assets,presentation,discovery,console,stats}.ts
    client/
      electron/  main.ts  netClient.ts  discovery.ts  preload.ts  storage.ts
      src/       app/ screens/ components/ canvas/ stores/ sync/ tools/ export/ design/ 
  tools/   chaos-proxy/  loadtest/  seed/  headless-client/
  design/  (impeccable context files, BRIEF.md, screens/)
  scripts/ (build, package, offline-verify)
  .github/workflows/build.yml
```

---

## 2. Protocol specification (normative)

### 2.1 Framing
Each message on the TCP stream is: **`[4-byte big-endian unsigned length N][N bytes UTF-8 JSON]`**.
- `MAX_FRAME = 4 MiB`. Larger length → protocol error → close connection.
- `FrameDecoder` is a streaming class: handles frames split across TCP chunks and many frames coalesced in one chunk. Must be fuzz-tested.
- Write path: single outbound queue per connection with **backpressure**: if `socket.writableLength > 8 MiB`, drop non-essential (ephemeral) messages first; if still above 16 MiB, disconnect the slow client (it will resync on reconnect).

### 2.2 Envelope
```ts
interface Envelope<P = unknown> {
  v: 1;            // protocol version
  t: string;       // message type (see catalog)
  id?: string;     // message id (for request/response correlation)
  rid?: string;    // id of the request this replies to
  ts?: number;     // server epoch ms (set by server on server→client)
  p: P;            // payload
}
```

### 2.3 Message catalog
Direction: **C→S** client to server, **S→C** server to client.

| `t` | Dir | Payload | Purpose |
|---|---|---|---|
| `hello` | C→S | `{clientId, app, appVersion, platform}` | First frame. Must arrive within 5 s. |
| `hello_ack` | S→C | `{serverId, serverName, serverTime, hbIntervalMs:5000, hbTimeoutMs:15000, limits}` | Handshake result |
| `ping` / `pong` | both | `{n}` | Heartbeat + RTT measurement |
| `room_create` | C→S | `{name, username, password?, settings?}` | Create **and** join as owner |
| `room_join` | C→S | `{code, username, resumeToken?, ownerKey?, lastSeq?}` | Join (or resume) |
| `auth_challenge` | S→C | `{salt, nonce, kdf:{N,r,p}}` | Room is password-protected |
| `auth_proof` | C→S | `{proof}` | `proof = HMAC-SHA256(scrypt(password,salt), nonce)`; password never sent |
| `join_pending` | S→C | `{}` | Waiting for owner approval (if enabled) |
| `join_request` | S→C (owner) | `{pendingId, username}` | Ask owner |
| `join_decide` | C→S (owner) | `{pendingId, allow}` | Owner decision |
| `join_ok` | S→C | `{you, participants, settings, seq, mode:'snapshot'\|'delta', snapshot?, ops?, chat[], present, resumeToken, ownerKey?}` | Joined; carries canvas state |
| `join_denied` | S→C | `{code, message}` | Rejected |
| `room_leave` | C→S | `{}` | Graceful leave |
| `participant_joined` / `participant_left` / `participant_updated` | S→C | `{participant}` | Roster changes (`status: online\|reconnecting`) |
| `role_set` | C→S (owner) | `{userId, role}` | Change role |
| `kick` | C→S (owner) | `{userId, ban?:boolean}` | Remove / ban |
| `owner_transfer` | C→S (owner) | `{userId}` | Hand over ownership |
| `settings_update` | C→S (owner) | `{patch}` | Room settings |
| `settings_changed` | S→C | `{settings}` | Broadcast |
| `op` | C→S | `{opId, op}` | **Committed** whiteboard operation (sequenced, persisted) |
| `op_applied` | S→C | `{seq, opId, by, op}` | Authoritative result, sent to **all** (incl. sender = ack) |
| `op_rejected` | S→C | `{opId, code, message}` | Validation/permission failure |
| `eph` | C→S | `{k, d}` | **Ephemeral** event (cursor, live stroke/shape/drag preview, typing, editing-lock, viewport, laser) |
| `eph` | S→C | `{k, by, d}` | Relayed to others only; never stored |
| `sync_req` | C→S | `{fromSeq}` | Request missing ops |
| `sync_delta` | S→C | `{fromSeq, toSeq, ops[]}` | Missing ops |
| `sync_snapshot` | S→C | `{seq, snapshot}` | Full state when delta unavailable |
| `checkpoint` | S→C | `{seq, hash, count}` | Periodic integrity check (every 200 ops or 30 s) |
| `chat_send` | C→S | `{cid, text}` | `cid` = client dedup id |
| `chat_msg` | S→C | `{id, by, username, text, ts, system?}` | Broadcast incl. sender |
| `snap_save` / `snap_list` / `snap_get` / `snap_restore` / `snap_delete` | C→S | see Phase 3-S5 | Version history |
| `snap_list_result` / `snap_data` / `snap_changed` | S→C | | |
| `asset_have` / `asset_have_result` | both | `{hash}` / `{hash, have}` | Dedup check |
| `asset_put` | C→S | `{hash, mime, size, idx, total, data(base64)}` | Chunked upload (≤512 KiB raw per chunk) |
| `asset_put_ok` | S→C | `{hash}` | Upload complete |
| `asset_get` / `asset_chunk` | C→S / S→C | `{hash}` / `{hash, mime, idx, total, data}` | Download |
| `present_set` | C→S | `{active, frameId?, index?}` | Presenter control (owner/editor-presenter) |
| `present_state` | S→C | `{active, presenterId, frameId?, index?}` | Broadcast + in join_ok |
| `error` | S→C | `{code, message, ref?}` | Protocol-level error |
| `bye` | both | `{reason}` | Orderly close |

**Error codes:** `BAD_FRAME, BAD_MSG, UNSUPPORTED_VERSION, ROOM_NOT_FOUND, ROOM_FULL, AUTH_REQUIRED, AUTH_FAILED, LOCKED_OUT, BANNED, DENIED, USERNAME_TAKEN, FORBIDDEN, READ_ONLY, RATE_LIMITED, TOO_LARGE, INVALID_OP, TARGET_MISSING, NOT_FOUND, INTERNAL`.

### 2.4 Ordering, reliability, duplicates, loss (the "synchronization strategy")
- **Single authority:** the server assigns a gap-free, monotonically increasing `seq` per room to each accepted op. `seq` defines the one true order. Clients never reorder.
- **Idempotency:** every op has a client-generated `opId`. Server keeps the last 10 000 `opId → seq` per room; a duplicate `op` is **not** re-applied, the original `op_applied` is re-sent to the sender only.
- **Client duplicates:** client ignores any `op_applied` with `seq <= lastSeq`.
- **Gaps:** if client receives `seq > lastSeq + 1`, it buffers, sends `sync_req{fromSeq:lastSeq}`; server answers with `sync_delta` (if within the retained log of last 5 000 ops) or `sync_snapshot`.
- **Delay:** TCP preserves order; slow clients are tolerated until backpressure limits (2.1).
- **Integrity:** `checkpoint{seq,hash}`: when the client's `lastSeq === seq` it compares its state hash; mismatch → automatic `sync_req` with `fromSeq:-1` (full snapshot).
- **Ephemeral events** are best-effort, unsequenced, coalesced (cursor ≤ 30 Hz, previews ≤ 30 Hz). The committed `op` that ends a gesture is authoritative and replaces any preview, so lost previews never corrupt state.
- **Concurrency policy:** ops from different users apply in arrival order at the server; conflicts on the same element property resolve **last-writer-wins by seq, per property** (a `patch` carries only changed properties). Delete wins over later patches (those are rejected `TARGET_MISSING`).

### 2.5 Heartbeats, timeouts, reconnection
- Client sends `ping` every 5 s. Server closes any connection silent for 15 s. Client declares the server dead after 15 s without any frame.
- Handshake timeout 5 s (`hello` required). Join timeout 30 s (approval/auth).
- On unexpected drop the server keeps the participant as `reconnecting` for **120 s** (session not terminated, others notified). Client reconnects with exponential backoff `0.5 s → 8 s` + jitter, then sends `room_join{code, resumeToken, lastSeq}`; server replies `join_ok` with `mode:'delta'` (or snapshot). Pending local ops are re-sent (dedup protects). After the grace period the participant is removed.
- A second connection presenting the same `resumeToken` replaces the first.

### 2.6 Handshake sequences
1. `hello → hello_ack`
2. `room_create → join_ok(role=owner, ownerKey)` **or** `room_join → [auth_challenge → auth_proof] → [join_pending → (owner join_decide)] → join_ok | join_denied`
3. Steady state: `op/op_applied`, `eph`, `chat_*`, `ping/pong`, `checkpoint`.

---

## 3. Data model & semantics (normative)

### 3.1 Board state
```ts
interface BoardState { seq: number; elements: Record<string, Element>; frames: string[] /* ordered frame ids */ }
```
### 3.2 Elements
Common fields: `id, type, x, y, w?, h?, angle?, z (fractional index), authorId, authorName, createdAt, updatedAt, ver (server-incremented per change, used for hashing), locked?, groupId?, frameId?, style{stroke, fill|null, strokeWidth, opacity, dash:'solid'|'dashed'|'dotted', fontSize?, bold?, italic?, align?}`.

Types:
- `stroke` — `points: number[]` flat `[x0,y0,x1,y1…]` (world coords, 1 decimal), `tool:'pen'|'highlighter'`
- `erase` — `points`, `size` (pixel-eraser path; rendered with `destination-out` in z-order)
- `rect | roundrect | ellipse | diamond | triangle | parallelogram | hexagon` — optional `text` label
- `line | arrow` — `points` (≥2), `route:'straight'|'elbow'|'curve'`, `startHead/endHead`, `start?: Bind`, `end?: Bind` where `Bind = {elId, anchor:'auto'|'top'|'right'|'bottom'|'left'}`. **Bound endpoints are derived at render time** from the target shape, so moving a shape re-routes connectors on every client without extra ops.
- `text` — `text`, `fontSize`
- `sticky` — `text`, `color` (palette key), auto-height
- `image` — `assetId (sha256)`, `natW`, `natH`
- `mindnode` — `text`, `parentId|null`, `side:'left'|'right'`, `collapsed?`, `color?`. Edges are derived from `parentId`.
- `frame` — `title`, `w`, `h` (slide region; order in `BoardState.frames`)

Limits (enforced by schema + server): ≤ 20 000 points per stroke, text ≤ 5 000 chars, ≤ 50 000 elements per room, coordinates within ±1e6, style values in allowed sets.

### 3.3 Operations (committed)
`add{el}`, `patch{id, set}`, `remove{ids[]}`, `batch{ops[]}` (atomic), `clear{}`, `replace_state{state}` (restore/import), `frames_order{ids[]}`.
Reorder = `patch` of `z`. The server **overwrites** `authorId/authorName/createdAt` from the authenticated connection (anti-spoofing) and increments `ver`.
`apply(state, op, ctx) → {state', changedIds, inverse?}` is a **pure function in `shared`**, used identically by server and clients.

### 3.4 Undo / redo (well-defined multi-user behavior)
- **Per-user history**: Ctrl+Z undoes *your own* last gesture only; never other users' work.
- History entry = `{forward: Op, inverse: Op}` captured when the gesture commits (one entry per gesture: a stroke, a move of N elements, a paste…). Cap 200.
- Undo sends the **inverse as a new normal op** (so it is sequenced, logged, and broadcast like any op). Redo sends the forward op again. A new user action clears that user's redo stack.
- Conflict rules (document in code): 
  - undo of `add` → `remove` (if already removed by someone: no-op, entry dropped). 
  - undo of `remove` → `add` with same id (if id exists again: skip). 
  - undo of `patch` → patch restoring the *previous values of only the properties that user changed*; if the element is gone → entry dropped; if another user changed that property in between, the undo still applies (last-writer-wins) — toast "Undone (overrode a newer change)". 
  - `clear` stores all removed elements; undo re-adds those ids that are still absent. 
  - Entries that cannot apply are discarded silently with a subtle toast.
- Clear/restore performed by someone else does not remove your history entries; they simply no-op when targets are missing.

### 3.5 Roles & permissions
Roles: `owner` (creator; reclaimable via `ownerKey`), `editor`, `viewer`.

| Action | owner | editor | viewer |
|---|---|---|---|
| Draw / edit / delete elements, add images | ✔ | ✔ | ✖ |
| Undo/redo own ops | ✔ | ✔ | ✖ |
| Clear canvas | ✔ | only if `editorsCanClear` | ✖ |
| Chat | ✔ | ✔ | ✔ if `chatEnabled && !viewerChatMuted` |
| Cursor presence / follow / view | ✔ | ✔ | ✔ |
| Save named version / restore / delete version | ✔ | save ✔, restore only if `editorsCanClear` | ✖ |
| Import board / settings / roles / kick / ban / approve joins | ✔ | ✖ | ✖ |
| Start presentation | ✔ | ✔ (if `editorsCanPresent`) | ✖ |

Room settings: `{name, passwordProtected, requireApproval, defaultRole:'editor'|'viewer', editorsCanClear, editorsCanPresent, chatEnabled, boardLocked, maxParticipants (default 50)}`. `boardLocked` makes the board read-only for everyone except the owner ("protected workspace").

### 3.6 Client sync engine (renderer)
- Maintains `confirmed` (server truth at `lastSeq`) and `pending` (own ops sent but not yet acknowledged, in order) and a derived `view` (confirmed with pending replayed on top). 
- Local action → apply to `view` immediately (optimistic) → send `op` → `pending.push`. 
- `op_applied` own opId → remove from `pending`. Foreign op → apply to `confirmed`, then for each touched id recompute `view[id] = fold(pending, confirmed[id])`. 
- `op_rejected` → drop from `pending`, recompute view for its ids, toast reason. 
- Offline/reconnect: `pending` is persisted to disk by the main process; on reconnect all pending ops are re-sent in order (server dedups by `opId`).

---

## 4. Non-functional budgets
- p95 op fan-out latency (client send → other client receive) **< 40 ms** on loopback with 20 clients; < 100 ms on real LAN.
- Drawing user steady-state upstream < 60 KB/s (batching + RDP simplification + 1-decimal quantization).
- 60 fps pan/zoom with 5 000 strokes (static-layer caching, culling, spatial index).
- Join with 5 000 elements < 1 s.
- Server memory < 300 MB with 10 active rooms; no unbounded growth (log caps, eviction).
- No frame-blocking work > 50 ms on the renderer main thread.

---

## 5. Phases and steps

### PHASE 0 — Bootstrap & tracking
- [ ] **P0-S1 Monorepo scaffold.** npm workspaces, `tsconfig.base.json` (strict), eslint + prettier, vitest config, scripts: `dev:server`, `dev:client`, `build`, `test`, `typecheck`, `lint`, `package:server`, `package:client`, `package:source`. *Accept:* `npm run typecheck && npm test` pass on empty packages.
- [ ] **P0-S2 Tracking files.** Generate `PROGRESS.md` from this plan (all phases/steps/gates as checkboxes with a status line at top: current phase, last commit), `DECISIONS.md`, `BLOCKERS.md`. *Accept:* PROGRESS lists every step ID in this file.
- [ ] **P0-S3 Install the impeccable skill.** Install per its README (repo: `github.com/pbakaus/impeccable`) into the agent's skills location. Verify it is discoverable (list skills / run its help). Record the version and available commands in `DECISIONS.md`. Command names can differ by version — use whichever commands the installed version provides for: *teach/setup design context*, *shape/plan UX*, *craft/build*, *critique*, *audit*, *polish*, *normalize*, *harden*, *adapt*, *animate*. *Accept:* skill invocation works.
- [ ] **P0-S4 Tool versions.** `.nvmrc` = 22; verify Electron major compatible with Node; add `.editorconfig`, `.gitignore`.
- **GATE 0:** repo builds, tracking files exist, skill installed.

### PHASE 1 — Shared core (`packages/shared`)
- [ ] **P1-S1 Constants/ids/errors.** Ports, limits, protocol version, error-code enum, id helpers, palette of 12 colorblind-distinct **user identity colors**.
- [ ] **P1-S2 Framing codec.** `encodeFrame`, streaming `FrameDecoder`. Tests: split at every byte offset, coalesced frames, zero-length, oversize, invalid UTF-8/JSON, 10 000 random frames fuzz. *Accept:* all pass.
- [ ] **P1-S3 Protocol types + zod schemas** for every message in §2.3, `parseEnvelope()`, builders `msg(type, payload, extras)`. Reject unknown types/extra-large fields. *Accept:* round-trip tests per message type.
- [ ] **P1-S4 Element model + schemas + limits** (§3.2), factory helpers, quantization (`round1`), style defaults.
- [ ] **P1-S5 Reducer.** `applyOp` per §3.3 with `ver`, `changedIds`, atomic `batch`, `clear`, `replace_state`, `frames_order`, anti-spoofing context (`by`, `byName`, `ts`). Tests for each op, atomic batch rollback on failure, deterministic result.
- [ ] **P1-S6 Inverse builder + `UndoManager`** (§3.4) with conflict-rule tests (concurrent remove, concurrent patch, clear-undo partial).
- [ ] **P1-S7 Geometry library.** Bounds (rotated), hit-testing for every element type, point-to-polyline distance, RDP simplification, rotate/scale transforms, anchors for shapes, elbow router (orthogonal, avoids target bounds), curve control points, tidy-tree layout for mind maps (horizontal, left/right sides), frame containment. Unit tests.
- [ ] **P1-S8 State hash + fuzz convergence.** `stateHash(state)` incremental-friendly (sum of `fnv(id|ver)`). Fuzz: 5 simulated replicas, 2 000 random interleaved ops incl. undo/redo, delivered in server order → all hashes equal.
- **GATE 1:** `npm test -w packages/shared` green, coverage ≥ 85 % on reducer/framing/undo.

### PHASE 2 — Server core (`packages/server`)
- [ ] **P2-S1 Server skeleton.** CLI flags (`--port --host --name --data --max-clients --no-discovery --log-level`), optional `config.json`, timestamped logger, graceful shutdown (SIGINT/SIGTERM flush), TCP listener, `Connection` wrapper (FrameDecoder, outbound queue with backpressure §2.1, per-connection state machine `new→hello→lobby→joined→closed`).
- [ ] **P2-S2 Handshake, heartbeat, timeouts.** Version check, 5 s handshake timeout, 15 s idle timeout, ping/pong RTT recorded, per-IP connection cap (default 20), global cap.
- [ ] **P2-S3 Room manager.** 6-char codes from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` via `crypto.randomInt`, collision-safe; create with settings; `ownerKey` (32 random bytes) returned once; list; idle eviction from memory; delete.
- [ ] **P2-S4 Join flow.** Username rules (1–24 chars, trimmed, no control chars, unique case-insensitively among active participants → `USERNAME_TAKEN`), color assignment (unique within room from palette), role assignment (`defaultRole`), optional join approval (pending queue, 30 s timeout), scrypt password challenge/proof (constant-time compare), lockout (5 failures/IP/60 s → `LOCKED_OUT`), ban list (clientId + IP), resume tokens (120 s grace, `reconnecting` status), `ownerKey` reclaim, roster broadcast on join/leave/update.
- [ ] **P2-S5 Chat service.** Broadcast to all (incl. sender), 500-message history persisted in room, 2 000-char limit, rate limit 5 msg/s, dedup by `cid`, system messages (joined/left/role changed), typing via `eph`.
- [ ] **P2-S6 Permission engine.** Central `can(role, action, settings)` implementing §3.5; handlers for `role_set`, `kick`, `owner_transfer`, `settings_update`; settings change broadcasts; kicking closes with `bye`.
- [ ] **P2-S7 Headless test client** (`tools/headless-client`, reuses shared) + integration tests with real sockets: handshake, bad frames, create/join/leave, wrong password, approval, duplicate username, resume within/after grace, kick/ban, roles, chat ordering with 5 concurrent senders.
- **GATE 2:** server integration tests green; manual run prints LAN addresses and accepts a headless client.

### PHASE 3 — Board engine, persistence, extras on the server
- [ ] **P3-S1 Op pipeline.** `op` → size/schema validation → permission (`READ_ONLY` when `boardLocked`/viewer) → dedup → per-element target checks → `apply` (shared reducer) → `seq++` → append oplog → broadcast `op_applied` to all → on failure `op_rejected`. Per-room serialized processing (single event loop ⇒ no locks; document this in code comments as the concurrency model). Token-bucket rate limit (200 ops/s/user, burst 400).
- [ ] **P3-S2 Ephemeral relay.** Validate kind/size, role check (viewers: cursor/viewport only), per-user coalescing at 30 Hz, never persisted, never to sender. Server-side `editing` soft-lock registry (element id → user, TTL 30 s) broadcast via `eph`.
- [ ] **P3-S3 Sync.** `join_ok` with snapshot or delta from `lastSeq`; `sync_req` → delta/snapshot; `checkpoint` broadcasts; op log retention 5 000 ops.
- [ ] **P3-S4 Persistence.** Layout `data/rooms/<code>/{meta.json,state.json,oplog.jsonl,snapshots/,assets/}`. Atomic `state.json` (tmp+rename) debounced 2 s and on shutdown; append-only oplog buffered; crash recovery = load state + replay oplog `seq > state.seq`; room TTL (default 7 days idle); `room code` sanitized (no path traversal).
- [ ] **P3-S5 Version history.** Auto snapshot every 5 min if changed, before `clear`, before `replace_state`; manual `snap_save{label, thumb?}`; `snap_list` → metadata (id, label, by, ts, elementCount, thumb?); `snap_get`/`snap_data` (for client-side preview); `snap_restore` → takes a safety snapshot then emits `replace_state` through the normal op pipeline; `snap_delete`; retention 50. Permissions per §3.5. Broadcast `snap_changed`.
- [ ] **P3-S6 Assets.** `asset_have`, chunked `asset_put` (verify sha256 and size, magic-byte check for png/jpeg/webp/gif, max 8 MiB, 200 MiB/room), `asset_get` chunking, stored on disk by hash, dedup.
- [ ] **P3-S7 Presentation state.** `present_set` / `present_state` (active, presenterId, frameId/index) held in room, included in `join_ok`; presenter disconnect → auto end after grace.
- [ ] **P3-S8 Board import/export on server.** Owner-only `replace_state` from an uploaded board JSON (client sends as op after assets are uploaded); validated through full schema.
- [ ] **P3-S9 Discovery + console.** UDP responder on 5051 (`WB_DISCOVER/1` → JSON `{name, tcpPort, rooms, version}`), startup banner listing every LAN IPv4 with the port, live stats line every 10 s (clients, rooms, ops/s, RSS), console commands: `rooms`, `clients`, `kick <code> <user>`, `close <code>`, `stats`, `quit`.
- [ ] **P3-S10 Server tests.** Convergence under concurrent ops from 10 clients, duplicate op resend, delta vs snapshot sync, restart recovery (kill -9 simulated), snapshot restore, permission matrix, asset integrity, rate limiting, checkpoint mismatch recovery.
- **GATE 3 (server complete):** all server tests green; 10 headless clients drawing randomly for 60 s end with identical hashes; restart recovery verified. Tag `server-complete`.

### PHASE 4 — Client foundation (`packages/client`)
- [ ] **P4-S1 Electron skeleton.** `main.ts`, `preload.ts`, Vite+React renderer, strict CSP (`default-src 'self'`, no remote), `contextIsolation: true`, `nodeIntegration: false`, block navigation/new windows, deny all permission requests. **Must allow multiple simultaneous instances** (no single-instance lock); support `--user-data-dir=<path>` and `--name=<label>` for testing several clients on one machine.
- [ ] **P4-S2 `NetClient` (main process).** TCP connect with timeout, `hello`, framing, heartbeat, reconnect FSM (`idle→connecting→handshaking→joining→live↔reconnecting→closed|kicked`), backoff+jitter, resume token handling, UDP discovery listener, IPC bridge (`net:connect`, `net:send`, `net:status`, `net:message`, `net:discover`). All state transitions logged and exposed to UI.
- [ ] **P4-S3 Renderer stores + `SyncEngine`** per §3.6: session, board (`confirmed/pending/view`), participants/presence, chat, settings, versions, ui prefs. Gap detection, buffering, `sync_req`, checkpoint verification, duplicate suppression, `op_rejected` handling.
- [ ] **P4-S4 Pending-queue persistence.** Main process stores `pending` + last confirmed snapshot per `(server, room)` in userData; restored on app restart/reconnect.
- [ ] **P4-S5 Headless sync tests.** Run `SyncEngine` (node env) against the real server: optimistic apply, ack, rejection, reconnect resend, forced gap, forced hash mismatch.
- **GATE 4:** headless tests green; Electron window launches, connects, creates a room, and logs board ops in dev console (no UI yet).

### PHASE 5 — Design foundation (use impeccable)
- [ ] **P5-S1 Design context.** Run impeccable's setup/teach step and write its context files (e.g. product/design context) using this brief:
  - **Product:** realtime classroom/lab whiteboard on a LAN. **Register:** product UI (the canvas is the hero; chrome recedes).
  - **Users:** students and instructors in labs and classrooms; long sessions; projectors and bright rooms; mid-range Windows laptops; touch/stylus possible.
  - **Tone:** calm, precise, quietly confident, "studio/workshop" — not corporate-SaaS, not playful-toy.
  - **Constraints:** light + dark themes; WCAG AA minimum (AAA for canvas-adjacent controls where feasible); full keyboard access; `prefers-reduced-motion`; OKLCH tokens with tinted neutrals; **all fonts bundled/local**; icons from bundled lucide; identity colors must be colorblind-distinct and readable on both canvas backgrounds; layout works from 1100×650 up to 4K; UI scale option (100/125/150 %).
  - **Avoid:** purple-blue gradient defaults, gradient text, glassmorphism everywhere, nested cards, side-stripe accent borders, emoji icons, modal-first interactions, generic overused font choices.
- [ ] **P5-S2 Shape the UX.** Using impeccable's shaping/planning command, produce `design/BRIEF.md`: screen inventory (Connect, Board, Version history, Room settings, Export, Shortcuts, Presentation), information architecture, key flows (create room, join with password, owner approval, reconnect, offline edit, present), empty/error/loading states, tool rail contents and grouping, properties bar behavior, right-dock tabs (Chat / People / History / Frames).
- [ ] **P5-S3 Tokens, typography, theme, base components.** Implement CSS custom properties (color, type scale, spacing, radius, elevation, motion, z-layers), theme switch (system/light/dark), bundled fonts, and base components built with impeccable's craft guidance: Button, IconButton, Tooltip, Popover, Menu, Tabs, Switch, Slider, ColorSwatchPicker, Segmented, Avatar(with identity color), Badge, Toast, Dialog (rare), Kbd, ScrollArea, ResizableDock. Storybook-less: a hidden `/design-gallery` route showing every component in both themes.
- [ ] **P5-S4 Connect screen.** Server address (host:port, validation), discovered LAN servers list (live), recent servers, username (remembered), tabs *Create room* / *Join room* (code input with auto-format, password field when needed, settings for create: name, password, approval, default role), entry points to *Work offline / open local board*, clear connection-error states and copy.
- [ ] **P5-S5 Board shell layout.** Top bar (room name, code chip with copy, connection status, role badge, participant avatars, undo/redo, export, versions, present, settings), left tool rail, contextual properties bar, canvas region (placeholder), right dock (resizable, collapsible), bottom-left zoom controls, bottom status line. Responsive down to 1100×650; dock collapses to overlay below 1280 px.
- **GATE 5:** Both themes render; keyboard-navigable shell; screenshots of Connect + Board shell saved to `design/screens/`.

### PHASE 6 — Canvas engine & core drawing (mandatory features)
- [ ] **P6-S1 Viewport.** World↔screen transforms, wheel/pinch zoom (0.1–8×, cursor-anchored), space/middle-drag/hand-tool pan, dot-grid background (CSS/offscreen, not part of the drawing layer), fit-to-content, zoom % control, small minimap (toggle).
- [ ] **P6-S2 Render pipeline.** Static canvas (committed elements, redrawn only when changed/viewport changes, cached `Path2D` per stroke, viewport culling via `rbush`, DPR-correct) + dynamic canvas (previews, selection UI, remote cursors, laser). `requestAnimationFrame` dirty-flag loop. Renderers for every element type (implement all now, tools come later).
- [ ] **P6-S3 Freehand pen + highlighter.** Pointer Events with `getCoalescedEvents`, smoothing (quadratic midpoints), color picker (palette + custom), width 1–40, opacity, live local render, ephemeral `stroke_preview` batches at ≤30 Hz, on release: RDP simplify (ε ≈ 0.6/zoom), quantize, commit one `add` op.
- [ ] **P6-S4 Erasers.** *Object eraser* (drag across strokes/shapes → batched `remove` on release, with hover highlight) and *pixel eraser* (`erase` element with size; rendered in z-order). Respect roles.
- [ ] **P6-S5 Presence & authorship.** Remote cursors (arrow + name label in identity color, fade after 5 s idle) from `eph cursor` (≤30 Hz, world coords), remote live stroke previews in author color, **Authorship overlay toggle** (hover tooltip "drawn by X", optional tinted outline by author), "Follow participant" (viewport `eph`), per-user color chip everywhere.
- [ ] **P6-S6 Undo/redo.** Wire `UndoManager`; gesture grouping; Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y; toolbar buttons with disabled state; subtle toast when an entry is skipped.
- [ ] **P6-S7 Clear canvas.** Permission-aware button; lightweight inline confirmation (not a heavy modal); emits `clear` (undoable by the clearer); auto pre-clear snapshot on server.
- **GATE 6:** Two Electron instances (`--user-data-dir`) draw simultaneously, see each other's strokes/cursors live, erase, undo, clear; late joiner sees the existing board. `tools/e2e` Playwright test proves stroke propagation A→B.

### PHASE 7 — Collaboration UI (completes all mandatory requirements)
- [ ] **P7-S1 Session controls.** Wire create/join/leave; code chip (copy), server address display, role/status, host controls menu.
- [ ] **P7-S2 Participants panel.** Roster with identity color, role badge, status (online / reconnecting), "follow" button, owner menu (change role, kick, ban, transfer ownership), join-approval prompt (non-modal toast/list), join/leave notifications.
- [ ] **P7-S3 Chat panel.** Chronological list with sender username (in identity color) + timestamp, message grouping, system messages, composer (Enter send / Shift+Enter newline), unread badge when dock tab not active, typing indicator, disabled state when `chatEnabled=false`/muted.
- [ ] **P7-S4 Connection & recovery UX.** Status pill (Connected / Reconnecting… / Offline), banners, "Resynced" confirmation, RTT indicator, clear kicked/banned/room-closed screens, graceful auto-rejoin.
- [ ] **P7-S5 Save/restore & version history panel.** Save named version (with client-rendered 320 px thumbnail), list (auto/manual badges, author, time, element count), preview in read-only overlay, restore (permission-gated, confirm inline), delete.
- [ ] **P7-S6 Room settings.** Owner dialog/panel: name, password set/change/remove, approval, default role, editors-can-clear, editors-can-present, chat enabled, lock board. Live `settings_changed` handling for everyone.
- [ ] **P7-S7 Toast/notification system** wired to rejections, role changes, joins/leaves, kicks.
- **GATE 7 (all mandatory requirements done):** manual checklist in §6 rows M1–M20 all pass with 3 instances; tag `v0.1-core`.

### PHASE 8 — Diagramming & content tools (additional features)
- [ ] **P8-S1 Selection & transform.** Select tool, click/shift-click, marquee, multi-select, move, resize (handles, aspect lock with Shift), rotate, snapping + smart guides, arrow-key nudge, copy/paste/duplicate (new ids, offset; clipboard via app-internal + system for images), delete, group/ungroup (`groupId`), z-order (bring forward/back via fractional `z`), lock/unlock, align/distribute. Moves emit `batch` patch on release, with throttled ephemeral `drag_preview` during drag.
- [ ] **P8-S2 Shapes & lines.** rect, round-rect, ellipse, diamond, triangle, parallelogram, hexagon, line, arrow (head styles), polyline; stroke/fill/dash/opacity; draw-with-preview; Shift = constrain; double-click to add label.
- [ ] **P8-S3 Text.** Text tool + shape labels; DOM textarea overlay for editing; font size, bold/italic, align; commit on blur/Esc/Ctrl+Enter; **soft lock** via `editing` ephemeral (others see "X is editing" and cannot edit that element until released/TTL).
- [ ] **P8-S4 Sticky notes.** Tool, color palette, auto-grow text, resize, quick-add (click), drag to reorder z, author initial badge.
- [ ] **P8-S5 Flowchart.** Connector binding to anchors (auto/top/right/bottom/left), derived geometry, elbow/curve/straight routing, re-route on move/resize, drag-from-handle to create a new connected node, flowchart shape palette (terminator, process, decision, input/output, document-like via existing shapes), connector labels, delete-shape-cleans-bindings behavior (connector keeps free end).
- [ ] **P8-S6 Mind map.** Mind-map tool: click creates root; **Tab** adds child, **Enter** sibling, **Del** deletes subtree, **Space** collapse; tidy-tree auto-layout (left/right sides) emitted as one `batch`; drag node moves subtree; curved derived edges; color per branch.
- [ ] **P8-S7 Image insertion.** Button, drag-drop, paste; client downscales to ≤1920 px and re-encodes (≤2 MB), sha256, `asset_have` → chunked `asset_put` with progress placeholder, then `add image`; on receive, lazy `asset_get` with in-memory + IndexedDB cache; broken-asset placeholder.
- [ ] **P8-S8 Frames.** Frame tool (titled regions, default 16:9), frames panel in dock (reorder via `frames_order`, rename, delete, jump-to), moving a frame moves elements whose center lies inside it.
- **GATE 8:** manual checklist rows A1–A12 pass; Playwright E2E: shape+connector+sticky+mindmap+image created on A appear identically on B (state hash equal).

### PHASE 9 — Presentation, export, offline editing
- [ ] **P9-S1 Presentation mode.** Start from frames; fullscreen, animated viewport transitions (instant if reduced motion), next/prev (arrows/space), progress indicator, laser pointer (ephemeral), exit with Esc; **everyone auto-follows presenter** via `present_state` with a "Follow presenter" toggle; late joiners snap to the current frame.
- [ ] **P9-S2 Export & import.** Export **PNG** (viewport / entire board / selection / each frame; 1×/2×; transparent option), **SVG** (vector, text as text, images embedded), **PDF** (jsPDF; board or one page per frame), **`.wbboard` JSON** (full state + embedded assets). Import `.wbboard` (owner → `replace_state` after asset upload; or open as local board). Native save dialogs via main process.
- [ ] **P9-S3 Offline editing & local boards.** On disconnect the board stays fully editable with banner "Offline — N changes waiting"; pending ops persisted; on reconnect re-sent and reconciled (LWW; ops on deleted targets rejected and counted in a summary toast). *Local board mode* from Connect screen: edit with no server, save/open `.wbboard`, and **"Share to a server"** which creates a room seeded from the local board.
- [ ] **P9-S4 Quality of life.** Shortcut cheat-sheet overlay (`?`), preferences (theme, UI scale, default colors, remembered username, identity color preference hint, recent servers), tool shortcuts: V select, H hand, P pen, Shift+P highlighter, E eraser, L line, A arrow, R rect, O ellipse, D diamond, T text, S sticky, M mind map, I image, F frame, F5 present, Ctrl+0 fit, Ctrl+± zoom.
- **GATE 9:** checklist rows A13–A20 pass; export outputs open correctly in a browser/PDF viewer; offline edit + reconnect test green.

### PHASE 10 — Resilience, security, performance
- [ ] **P10-S1 Chaos proxy** (`tools/chaos-proxy`): TCP proxy injecting latency/jitter, byte-level fragmentation, abrupt resets, half-open blackholes, and duplicate/dropped frame injection. Scenario tests: convergence holds, reconnect works, no duplicate application.
- [ ] **P10-S2 Missing/duplicate/delayed updates.** Tests that inject duplicate `op_applied`, skipped `seq`, delayed batches, forced checkpoint mismatch; assert client recovers via `sync_req`/snapshot.
- [ ] **P10-S3 Load & soak.** `tools/loadtest`: 50 headless clients, 5 min, mixed ops/ephemeral/chat; measure p50/p95/p99 fan-out latency and bandwidth; fix hotspots until §4 budgets are met; add `stats` output.
- [ ] **P10-S4 Security hardening.** Fuzz malformed frames and messages; slowloris (handshake timeout); per-IP limits; password brute force; room-code enumeration throttling; path-traversal tests; asset magic-byte checks; ensure no `innerHTML` with user data (text rendered via canvas/`textContent`); Electron hardening review (no `remote`, no `webSecurity:false`, protocol allow-list).
- [ ] **P10-S5 Leak & resource review.** Op-log caps, room eviction, listener cleanup, timers cleared, large-board join performance; renderer profiling at 5 000 strokes.
- **GATE 10:** chaos + load + security tests green; budgets in §4 met and recorded in `DECISIONS.md`.

### PHASE 11 — Design polish (use impeccable again)
- [ ] **P11-S1 Critique pass.** Run impeccable's critique on every screen/state; write findings to `design/CRITIQUE.md`; fix all high/medium issues.
- [ ] **P11-S2 Audit pass.** Run impeccable's audit (a11y, contrast, focus order, responsive, performance, theming); fix findings; verify keyboard-only completion of: connect → draw → chat → leave.
- [ ] **P11-S3 Polish & copy.** Micro-interactions (tool switch, panel open, toast), empty states, error/clarify copy, first-run hints (minimal, dismissible), loading skeletons, consistent focus rings, harden pass for long names/huge chat/slow networks/RTL-safe layout.
- [ ] **P11-S4 Theme & environment checks.** Dark theme, projector-friendly high-contrast mode, UI scale 100/125/150 %, adapt pass for 1100×650 and 4K.
- [ ] **P11-S5 Normalize.** Remove dead styles, unify tokens, ensure all components use tokens; refresh `design/screens/` (Connect, Board with content, Chat, People, History, Presentation, Export, both themes).
- **GATE 11:** no open high/medium design findings; screenshots refreshed.

### PHASE 12 — Packaging & demo readiness
- [ ] **P12-S1 Server executable.** esbuild bundle → `pkg` for `win-x64`, `linux-x64`, `macos-arm64`; `--help` documents all flags; smoke test: run exe, connect headless client, create room, draw, restart exe, state recovered.
- [ ] **P12-S2 Client executables.** `electron-builder`: Windows portable `.exe` (primary; no installer/admin needed), Linux AppImage, macOS dmg; app name/icon; `asar` on; verify the packaged app makes **zero** non-LAN network requests.
- [ ] **P12-S3 CI.** `.github/workflows/build.yml` matrix (windows-latest, ubuntu-latest, macos-latest) producing server + client artifacts. (Cross-building Windows from Linux is not required — CI does native builds.)
- [ ] **P12-S4 Offline verification.** `scripts/offline-verify.md|ts`: steps/script to run server + 3 clients with network disabled on loopback and on a real LAN; document Windows Firewall prompt handling and `--host 0.0.0.0`; include "ports blocked" error message in client with hint.
- [ ] **P12-S5 Demo tooling.** `tools/seed`: `npm run seed -- --server host:5050 --room CODE` fills a board (flowchart, mind map, stickies, frames, shapes, strokes, sample image, chat); `--bots N` spawns headless drawing bots so one machine can demonstrate many users.
- [ ] **P12-S6 Code-comment & hygiene audit.** Every file has a header; every export has JSDoc; ordering/dedup/undo/backpressure/recovery logic is explained inline; lint clean; `THIRD_PARTY.txt` generated; no dead code.
- [ ] **P12-S7 Final QA & source package.** Run the full §6 checklist; `npm run package:source` creates a clean source zip (no `node_modules`, `dist` separate) and `dist/` containing server and client executables per OS.
- **GATE 12 (done):** all checklist rows pass; executables run offline; `PROGRESS.md` fully ticked.

---

## 6. Requirement traceability / final acceptance checklist
Tick in `PROGRESS.md` (a "Final QA" section). Every row must pass with ≥3 client instances and the network disabled.

| ID | Requirement | Where built |
|---|---|---|
| M1 | Socket-based client–server architecture over TCP on LAN; works with internet off | P2, P4 |
| M2 | Freehand drawing, erase, color selection on shared canvas | P6-S3/S4 |
| M3 | Real-time sync with minimal delay (budget §4) | P3-S1/S2, P10-S3 |
| M4 | Server validates and distributes events, handles concurrency | P3-S1 |
| M5 | Consistent shared canvas for all participants (hash equal) | P1-S8, P3-S10 |
| M6 | Clear canvas with permissions | P6-S7, §3.5 |
| M7 | Save and restore whiteboard state | P3-S5, P7-S5 |
| M8 | Host session, join by LAN address + room code | P2-S3/S4, P5-S4 |
| M9 | Participant list + join/leave notifications | P2-S4, P7-S2 |
| M10 | Usernames; per-user colors, cursor indicators | P2-S4, P6-S5 |
| M11 | Join/leave without disrupting others; newcomers get current state | P3-S3 |
| M12 | Ops transmitted via sockets; broadcast to others | P3-S1 |
| M13 | Defined ordering, dedup, loss/delay handling | §2.4, P10-S2 |
| M14 | Disconnect detection, timeouts, reconnection without ending session | §2.5, P2-S2, P4-S2 |
| M15 | Group chat with sender + timestamp, chronological | P2-S5, P7-S3 |
| M16 | State representation, sync on join, recovery after reconnect | §3, P3-S3, P4-S3 |
| M17 | Undo/redo with defined multi-user behavior | §3.4, P1-S6, P6-S6 |
| M18 | Message format, framing, transport justification (code-level) | §2, P1-S2/S3 |
| M19 | Clean GUI: canvas, toolbar, participants, chat, session controls | P5, P7 |
| M20 | Basic access control (room code + password + approval + roles + lock) | P2-S4/S6, P7-S6 |
| A1 | Lines & shapes | P8-S2 |
| A2 | Flowcharts (bound connectors) | P8-S5 |
| A3 | Mind maps | P8-S6 |
| A4 | Sticky notes | P8-S4 |
| A5 | Image insertion | P8-S7 |
| A6 | Text boxes | P8-S3 |
| A7 | Selection/transform/group/z-order | P8-S1 |
| A8 | Frames | P8-S8 |
| A9 | Presentation mode | P9-S1 |
| A10 | Role-based editing permissions | §3.5, P2-S6, P7-S2 |
| A11 | Version history | P3-S5, P7-S5 |
| A12 | Exporting canvas (PNG/SVG/PDF/JSON) | P9-S2 |
| A13 | Offline editing + local boards + share-to-server | P9-S3 |
| A14 | LAN server auto-discovery | P3-S9, P5-S4 |
| A15 | Authorship overlay, follow user | P6-S5 |
| A16 | Soft element locks while text editing | P8-S3 |
| A17 | Shortcut cheat-sheet, preferences | P9-S4 |
| A18 | Light/dark themes, UI scale, high-contrast | P11-S4 |
| A19 | Server console commands & stats | P3-S9 |
| A20 | Demo seeder + bots | P12-S5 |

---

## 7. Pitfalls to handle explicitly
- **Nagle/latency:** `socket.setNoDelay(true)` on both ends; batch ephemeral events yourself.
- **Multiple instances for demos:** Electron needs distinct `--user-data-dir` per instance; no single-instance lock.
- **Firewall:** Windows prompts on first server run; bind to `0.0.0.0`; print every non-internal IPv4 address; client error copy suggests firewall/port checks.
- **Time:** never trust client clocks for ordering or display of chat timestamps; use server `ts`.
- **Fonts/assets offline:** verify by running the packaged app with networking disabled (no console CSP/network errors).
- **Large payloads:** never send images or snapshots in one giant frame; chunk assets (≤512 KiB), keep frames < 4 MiB.
- **Pointer input:** use Pointer Events + `setPointerCapture`; handle stylus/touch; disable browser gestures on the canvas (`touch-action: none`).
- **Text safety:** user text is only ever drawn on canvas or set via `textContent`.
- **Undo semantics:** never undo another user's work; keep inverse ops minimal (changed props only).
- **Determinism:** reducer must be pure and deterministic; no `Date.now()`/random inside it (inject via context).
