/** Zustand workspace store binds pure synchronization to the isolated Electron bridge. */
import { create } from "zustand";
import { SyncEngine } from "../sync/SyncEngine";
import {
  UndoManager,
  applyOp,
  emptyBoard,
  defaultSettings,
  msg,
  type BoardState,
  type Op,
  type Participant,
  type Settings,
  type Envelope,
  can,
} from "../../../shared/src/index";
interface Workspace {
  board: BoardState;
  you: Participant;
  participants: Participant[];
  settings: Settings;
  chat: any[];
  versions: any[];
  requests: any[];
  presence: Record<string, any>;
  present: any;
  status: string;
  detail: string;
  code: string;
  address: string;
  local: boolean;
  entered: boolean;
  pending: number;
  rtt: number;
  toast: string[];
  preview: BoardState | null;
  revision: number;
  imageProgress: number | null;
}
const localYou: Participant = {
  id: "local",
  username: "You",
  role: "owner",
  color: "#0072B2",
  status: "online",
};
/** Public store consumed by React; operations flow through submit rather than arbitrary state edits. */
export const useWorkspace = create<Workspace>(() => ({
  board: emptyBoard(),
  you: localYou,
  participants: [],
  settings: { ...defaultSettings },
  chat: [],
  versions: [],
  requests: [],
  presence: {},
  present: { active: false },
  status: "idle",
  detail: "",
  code: "LOCAL",
  address: "",
  local: true,
  entered: false,
  pending: 0,
  rtt: 0,
  toast: [],
  preview: null,
  revision: 0,
  imageProgress: null,
}));
/** One own-history manager per active board. */
export let history = new UndoManager();
/** Queue and authority state remain separately inspectable for recovery tests. */
export const engine = new SyncEngine((e) => {
  if (!useWorkspace.getState().local) void window.canvas.send(e);
});
let persistTimer: ReturnType<typeof setTimeout> | undefined;
engine.onChange = () => {
  useWorkspace.setState((s) => ({
    board: engine.view,
    pending: engine.pending.length,
    revision: s.revision + 1,
  }));
  if (typeof window !== "undefined") {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const s = useWorkspace.getState();
      void window.canvas.write(s.address + "/" + s.code, {
        confirmed: engine.confirmed,
        pending: engine.pending,
        by: engine.by,
        byName: engine.byName,
      });
      void window.canvas.ack(engine.confirmed.seq);
    }, 200);
  }
};
engine.onReject = (message) => notify(message);
/** Timed, screen-reader-announced notifications. */
export function notify(text: string) {
  useWorkspace.setState((s) => ({ toast: [...s.toast.slice(-3), text] }));
  setTimeout(
    () =>
      useWorkspace.setState((s) => ({
        toast: s.toast.filter((t) => t !== text),
      })),
    5500,
  );
}
/** Submit a gesture and retain only this user's inverse. */
export function submit(op: Op, record = true) {
  const s = useWorkspace.getState();
  const permitted = (value: Op): boolean =>
    value.kind === "batch"
      ? value.ops.every(permitted)
      : can(
          s.you.role,
          value.kind === "clear"
            ? "clear"
            : value.kind === "replace_state"
              ? "import"
              : "draw",
          s.settings,
        );
  if (!permitted(op)) {
    notify("Your role does not allow this change");
    return;
  }
  try {
    const before = applyOp(engine.view, op, {
      by: engine.by,
      byName: engine.byName,
      ts: Date.now(),
    });
    if (record) history.record(op, before.inverse);
    if (s.local) {
      engine.confirmed = before.state;
      engine.confirmed.seq++;
      engine.snapshot(engine.confirmed);
    } else engine.submit(op);
  } catch (error) {
    notify(error instanceof Error ? error.message : "Could not apply change");
  }
}
/** Undo/redo inverse ops travel through the same sequencing pipeline. */
export function undo(redo = false) {
  const op = redo ? history.redo(engine.view) : history.undo(engine.view);
  if (op) {
    submit(op, false);
    if (!redo && history.notice) notify(history.notice);
  } else notify("No applicable change in your history");
}
/** Session message sender is kept separate from committed drawing operations. */
export function send(e: Envelope) {
  if (!useWorkspace.getState().local)
    void window.canvas.send(e).catch((error) => notify(String(error)));
}
/** Enter an offline board with no socket or pending queue. */
export function openLocal(board = emptyBoard(), name = "Local board") {
  void window.canvas.disconnect();
  history = new UndoManager();
  engine.pending = [];
  engine.by = "local";
  engine.byName = "You";
  useWorkspace.setState({
    local: true,
    entered: true,
    code: "LOCAL",
    address: "",
    you: localYou,
    participants: [localYou],
    settings: { ...defaultSettings, name },
    chat: [],
    versions: [],
    status: "offline",
    detail: "",
    preview: null,
  });
  engine.snapshot(board);
}
/** Attach bridge listeners once; app lifecycle owns their cleanup. */
export function attachBridge() {
  const handleMessage = async (e: Envelope) => {
    const s = useWorkspace.getState();
    if (e.t === "join_ok") {
      const first = !s.entered || s.code !== e.p.code;
      if (first) {
        const restored = await window.canvas.read(s.address + "/" + e.p.code);
        if (restored) {
          engine.confirmed = restored.confirmed;
          engine.pending = restored.pending || [];
        }
        history = new UndoManager();
      }
      useWorkspace.setState({
        local: false,
        entered: true,
        you: e.p.you,
        code: e.p.code,
        settings: e.p.settings,
        participants: e.p.participants,
        chat: e.p.chat,
        present: e.p.present,
        detail: "",
      });
    }
    engine.receive(e);
    if (e.t === "op_applied")
      useWorkspace.setState((state) => {
        const presence = { ...state.presence };
        for (const kind of ["stroke_preview", "shape_preview", "drag_preview"])
          delete presence[e.p.by + ":" + kind];
        return { presence };
      });
    switch (e.t) {
      case "chat_msg":
        useWorkspace.setState((state) => ({
          chat: [...state.chat.filter((m) => m.id !== e.p.id), e.p].slice(-500),
        }));
        break;
      case "participant_joined":
      case "participant_updated":
        if (
          e.t === "participant_updated" &&
          s.participants.find((p) => p.id === e.p.participant.id)?.role !==
            e.p.participant.role
        )
          notify(`${e.p.participant.username} is now ${e.p.participant.role}`);
        useWorkspace.setState((state) => ({
          participants: [
            ...state.participants.filter((p) => p.id !== e.p.participant.id),
            e.p.participant,
          ],
          you:
            state.you.id === e.p.participant.id ? e.p.participant : state.you,
        }));
        if (e.t === "participant_joined")
          notify(e.p.participant.username + " joined");
        break;
      case "participant_left":
        useWorkspace.setState((state) => ({
          participants: state.participants.filter(
            (p) => p.id !== e.p.participant.id,
          ),
        }));
        notify(e.p.participant.username + " left");
        break;
      case "settings_changed":
        useWorkspace.setState({ settings: e.p.settings });
        break;
      case "snap_list_result":
        useWorkspace.setState({ versions: e.p.snapshots });
        break;
      case "snap_changed":
        send(msg("snap_list", {}));
        break;
      case "snap_data":
        useWorkspace.setState({ preview: e.p.state });
        break;
      case "join_request":
        useWorkspace.setState((state) => ({
          requests: [...state.requests, e.p],
        }));
        break;
      case "join_pending":
        useWorkspace.setState({
          detail: "Waiting for the room owner to approve your request.",
        });
        break;
      case "eph":
        useWorkspace.setState((state) => {
          const key = e.p.by + ":" + e.p.k,
            previous = state.presence[key];
          let payload = e.p;
          if (e.p.k === "stroke_preview" && e.p.d.append && e.p.d.el) {
            const old = previous?.d;
            const points =
              old?.el?.id === e.p.d.el.id && e.p.d.serial === old.serial + 1
                ? [...(old.el.points || []), ...(e.p.d.el.points || [])].slice(
                    -40000,
                  )
                : e.p.d.el.points;
            payload = { ...e.p, d: { ...e.p.d, el: { ...e.p.d.el, points } } };
          }
          return {
            presence: {
              ...state.presence,
              [key]: { ...payload, time: Date.now() },
            },
          };
        });
        break;
      case "present_state":
        useWorkspace.setState({ present: e.p });
        break;
      case "error":
      case "join_denied":
        notify(e.p.message);
        useWorkspace.setState({ detail: e.p.message });
        break;
      case "bye":
        notify(e.p.reason);
        break;
    }
  };
  // Preserve delivery order while recovering the disk-backed queue during join.
  let processing = Promise.resolve();
  const offMessage = window.canvas.onMessage((e) => {
    processing = processing
      .then(() => handleMessage(e))
      .catch((error) => notify("Could not recover session: " + String(error)));
  });
  const offStatus = window.canvas.onStatus((s) => {
    const previous = useWorkspace.getState().status;
    useWorkspace.setState(s);
    if (s.status === "live" && previous === "reconnecting")
      notify("Connected again — synchronizing your changes");
  });
  const offRtt = window.canvas.onRtt((rtt) => useWorkspace.setState({ rtt }));
  return () => {
    offMessage();
    offStatus();
    offRtt();
  };
}
