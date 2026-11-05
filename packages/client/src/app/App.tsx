/** Application screens join session controls, collaborative panels and the canvas workspace. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Gallery } from "../design/Gallery";
import {
  SquarePen,
  MousePointer2,
  Hand,
  Pen,
  Highlighter,
  Eraser,
  Square,
  Circle,
  Diamond,
  Minus,
  ArrowUpRight,
  Type,
  StickyNote,
  GitBranch,
  ImagePlus,
  Frame,
  Undo2,
  Redo2,
  Download,
  Settings as SettingsIcon,
  Users,
  MessageSquare,
  History,
  Presentation,
  Copy,
  LogOut,
  Plus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  Send,
  Wifi,
  Search,
  Maximize,
  Map,
  HelpCircle,
  Trash2,
  Lock,
  Layers,
  RotateCw,
  AlignLeft,
} from "lucide-react";
import { generateKeyBetween } from "fractional-indexing";
import {
  Button,
  IconButton,
  Tabs,
  Switch,
  ColorSwatchPicker,
  Slider,
  Avatar,
  Badge,
  ConfirmButton,
  Kbd,
  ResizableDock,
} from "../components/ui";
import { BoardCanvas, type Tool } from "../canvas/BoardCanvas";
import { SelectionProperties } from "../components/SelectionProperties";
import { type Viewport } from "../canvas/render";
import {
  useWorkspace,
  attachBridge,
  openLocal,
  send,
  submit,
  undo,
  history,
  notify,
  engine,
} from "../stores/workspace";
import {
  msg,
  can,
  IDENTITY_COLORS,
  makeElement,
  type BoardState,
  type Element,
} from "../../../shared/src/index";
import {
  exportBoard,
  exportFrames,
  parseBoardFile,
  thumbnail,
  boardBounds,
  assetData,
} from "../export/boardExport";
import {
  prepareImage,
  attachAssets,
  cacheImage,
  uploadImage,
} from "../tools/assets";
const tools: { id: Tool; label: string; icon: ReactNode; key: string }[] = [
  { id: "select", label: "Select", icon: <MousePointer2 />, key: "V" },
  { id: "hand", label: "Hand", icon: <Hand />, key: "H" },
  { id: "pen", label: "Pen", icon: <Pen />, key: "P" },
  {
    id: "highlighter",
    label: "Highlighter",
    icon: <Highlighter />,
    key: "Shift+P",
  },
  { id: "eraser", label: "Object eraser", icon: <Eraser />, key: "E" },
  { id: "pixel", label: "Pixel eraser", icon: <Eraser />, key: "" },
  { id: "rect", label: "Rectangle", icon: <Square />, key: "R" },
  { id: "ellipse", label: "Ellipse", icon: <Circle />, key: "O" },
  { id: "diamond", label: "Diamond", icon: <Diamond />, key: "D" },
  { id: "line", label: "Line", icon: <Minus />, key: "L" },
  { id: "polyline", label: "Polyline", icon: <Minus />, key: "" },
  { id: "arrow", label: "Arrow", icon: <ArrowUpRight />, key: "A" },
  { id: "text", label: "Text", icon: <Type />, key: "T" },
  { id: "sticky", label: "Sticky note", icon: <StickyNote />, key: "S" },
  { id: "mindnode", label: "Mind map", icon: <GitBranch />, key: "M" },
  { id: "image", label: "Image", icon: <ImagePlus />, key: "I" },
  { id: "frame", label: "Frame", icon: <Frame />, key: "F" },
];
/** Product wordmark uses the same bundled icon language as the editor. */
function Wordmark() {
  return (
    <div className="wordmark">
      <SquarePen strokeWidth={1.6} />
      <span>Canvas</span>
    </div>
  );
}
/** Connect/create/local entry keeps network errors beside the fields that resolve them. */
function Connect() {
  const s = useWorkspace();
  const [tab, setTab] = useState("Create room"),
    [host, setHost] = useState(
      localStorage.getItem("server") || "127.0.0.1:5050",
    ),
    [username, setUsername] = useState(localStorage.getItem("username") || ""),
    [name, setName] = useState("Workshop"),
    [code, setCode] = useState(""),
    [password, setPassword] = useState(""),
    [approval, setApproval] = useState(false),
    [viewers, setViewers] = useState(false),
    [servers, setServers] = useState<any[]>([]),
    [error, setError] = useState(""),
    [searching, setSearching] = useState(false);
  const discover = () => {
    setSearching(true);
    void window.canvas
      .discover()
      .then(setServers)
      .finally(() => setSearching(false));
  };
  useEffect(discover, []);
  const connect = async () => {
    setError("");
    const match = host.trim().match(/^([^:]+):(\d+)$/);
    if (!match) {
      setError(
        "Enter a LAN IP address and port, for example 192.168.1.10:5050.",
      );
      return;
    }
    if (!username.trim() || username.trim().length > 24) {
      setError("Enter a name between 1 and 24 characters.");
      return;
    }
    if (tab === "Join room" && code.length !== 6) {
      setError("Room codes contain six letters or numbers.");
      return;
    }
    localStorage.setItem("username", username.trim());
    localStorage.setItem("server", host);
    localStorage.setItem(
      "recentServers",
      JSON.stringify(
        [
          host,
          ...JSON.parse(localStorage.getItem("recentServers") || "[]").filter(
            (v: string) => v !== host,
          ),
        ].slice(0, 5),
      ),
    );
    useWorkspace.setState({ address: host, detail: "", local: false });
    try {
      await window.canvas.connect({
        host: match[1],
        port: Number(match[2]),
        username: username.trim(),
        mode: tab === "Create room" ? "create" : "join",
        name,
        code,
        password,
        identityColorHint:
          localStorage.getItem("identityColorHint") || undefined,
        settings: {
          requireApproval: approval,
          defaultRole: viewers ? "viewer" : "editor",
        },
      });
    } catch (e) {
      setError(String(e));
    }
  };
  const open = async () => {
    try {
      const text = await window.canvas.open();
      if (text) {
        const file = parseBoardFile(text);
        for (const [hash, data] of Object.entries(file.assets))
          cacheImage(hash, data);
        openLocal(file.state);
      }
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <main className="connect">
      <section className="connect-story">
        <Wordmark />
        <div className="intro">
          <h1>
            Good ideas
            <br />
            need room.
          </h1>
          <p>
            A shared space to sketch, connect thoughts, and work things out
            together. Right here on your local network.
          </p>
          <div className="network-note">
            <Wifi size={16} /> Your work stays on this network.
          </div>
        </div>
        <small>Built for the room you’re in.</small>
      </section>
      <section className="connect-form" aria-label="Connect to a workspace">
        <div>
          <h2>Bring everyone to the board.</h2>
          <p className="muted">Start a room or join one nearby.</p>
        </div>
        <Tabs
          items={["Create room", "Join room"]}
          value={tab}
          onChange={setTab}
        />
        <form
          className="form-fields"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <label>
            Server address
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.10:5050"
              autoComplete="off"
            />
          </label>
          <label>
            Your name
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={24}
              placeholder="How should others see you?"
              autoComplete="nickname"
            />
          </label>
          {tab === "Create room" ? (
            <label>
              Room name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
              />
            </label>
          ) : (
            <label>
              Room code
              <input
                className="code"
                value={code}
                onChange={(e) =>
                  setCode(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g, "")
                      .slice(0, 6),
                  )
                }
                placeholder="ABC234"
                maxLength={6}
              />
            </label>
          )}
          <label>
            {tab === "Create room"
              ? "Password (optional)"
              : "Room password (if required)"}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={200}
            />
          </label>
          {tab === "Create room" && (
            <>
              <Switch
                label="Approve people before they join"
                checked={approval}
                onChange={setApproval}
              />
              <Switch
                label="New participants start as viewers"
                checked={viewers}
                onChange={setViewers}
              />
            </>
          )}
          {(error || s.detail) && (
            <p className="error" role="alert">
              {error || s.detail}
            </p>
          )}
          <Button
            primary
            type="submit"
            disabled={["connecting", "handshaking", "joining"].includes(
              s.status,
            )}
          >
            {s.status === "joining"
              ? "Joining workspace…"
              : tab === "Create room"
                ? "Create workspace"
                : "Join workspace"}
            <ArrowUpRight />
          </Button>
        </form>
        <div className="local-actions">
          <Button onClick={() => openLocal()}>Work offline</Button>
          <Button onClick={() => void open()}>Open a board</Button>
        </div>
        <details>
          <summary>Recent servers</summary>
          {(
            JSON.parse(
              localStorage.getItem("recentServers") || "[]",
            ) as string[]
          ).map((address) => (
            <Button key={address} onClick={() => setHost(address)}>
              {address}
            </Button>
          ))}
        </details>
        <div className="divider discovered">
          <div className="inline-actions">
            <h3>Nearby servers</h3>
            <button className="text-link" onClick={discover}>
              <Search size={13} />
              {searching ? "Looking…" : "Refresh"}
            </button>
          </div>
          {servers.length ? (
            servers.map((server) => (
              <button
                className="server-row"
                key={server.host}
                onClick={() => setHost(server.host + ":" + server.tcpPort)}
              >
                <span>
                  {server.name}
                  <small> · {server.rooms} rooms</small>
                </span>
                <span className="muted">{server.host}</span>
              </button>
            ))
          ) : (
            <p className="muted">
              No servers discovered. You can still enter an address above.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
/** Focus-protected overlays are reserved for scoped settings, exports and keyboard help. */
function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>("button,input,select")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select,textarea,[tabindex="0"]',
        );
        if (items?.length) {
          const first = items[0],
            last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="panel-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="panel"
      >
        <div className="panel-head">
          <h2>{title}</h2>
          <IconButton label="Close panel" onClick={onClose}>
            <X />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
function Dock({
  tab,
  setTab,
  onClose,
  follow,
  onFollow,
  onJump,
}: {
  tab: string;
  setTab: (s: string) => void;
  onClose: () => void;
  follow: string | null;
  onFollow: (id: string | null) => void;
  onJump: (id: string) => void;
}) {
  const s = useWorkspace(),
    [chat, setChat] = useState(""),
    [label, setLabel] = useState(""),
    [unread, setUnread] = useState(0);
  const chatBottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tab === "History") send(msg("snap_list", {}));
  }, [tab]);
  useEffect(() => {
    if (tab === "Chat") {
      chatBottom.current?.scrollIntoView({ block: "end" });
      setUnread(0);
    } else setUnread((n) => n + 1);
  }, [s.chat.length]);
  const sendChat = () => {
    if (!chat.trim()) return;
    send(msg("chat_send", { cid: crypto.randomUUID(), text: chat.trim() }));
    if (s.local) notify("Chat is available when you share this board");
    setChat("");
  };
  return (
    <ResizableDock label="Collaboration panels">
      <div className="dock-header">
        <h3>Workspace</h3>
        {unread > 0 && tab !== "Chat" && <Badge>{unread} unread</Badge>}
        <IconButton label="Close workspace panel" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <Tabs
        items={["Chat", "People", "History", "Frames"]}
        value={tab}
        onChange={(value) => {
          setTab(value);
          if (value === "Chat") setUnread(0);
        }}
      />
      <div className="dock-content" role="tabpanel" aria-label={tab}>
        {tab === "Chat" && (
          <>
            {s.chat.length ? (
              s.chat.map((m) => (
                <div
                  key={m.id}
                  className={`message ${m.system ? "system" : ""}`}
                >
                  {!m.system && (
                    <div className="message-head">
                      <strong
                        style={{
                          color: s.participants.find((p) => p.id === m.by)
                            ?.color,
                        }}
                      >
                        {m.username}
                      </strong>
                      <time>
                        {new Date(m.ts).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                  )}
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
                </div>
              ))
            ) : (
              <>
                <MessageSquare />
                <h3>Keep the conversation here.</h3>
                <p className="muted">
                  Messages are shared with everyone in this workspace.
                </p>
              </>
            )}
            <div ref={chatBottom} />
            {Object.values(s.presence).some(
              (p: any) =>
                p.k === "typing" && p.d.active && Date.now() - p.time < 3000,
            ) && <small>Someone is typing…</small>}
          </>
        )}
        {tab === "People" && (
          <>
            {s.requests.map((request) => (
              <div className="version" key={request.pendingId}>
                <p>{request.username} would like to join.</p>
                <div className="inline-actions">
                  {[true, false].map((allow) => (
                    <Button
                      key={String(allow)}
                      onClick={() => {
                        send(
                          msg("join_decide", {
                            pendingId: request.pendingId,
                            allow,
                          }),
                        );
                        useWorkspace.setState({
                          requests: s.requests.filter(
                            (r) => r.pendingId !== request.pendingId,
                          ),
                        });
                      }}
                    >
                      {allow ? "Allow" : "Decline"}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
            {s.participants.map((p) => (
              <div className="person" key={p.id}>
                <Avatar name={p.username} color={p.color} />
                <div className="person-name" title={p.username}>
                  <strong>
                    {p.username}
                    {p.id === s.you.id ? " (you)" : ""}
                  </strong>
                  <small>
                    {p.role} · {p.status}
                  </small>
                </div>
                {p.id !== s.you.id && (
                  <details>
                    <summary aria-label={`Actions for ${p.username}`}>
                      <ChevronDown size={15} />
                    </summary>
                    <div className="inline-actions">
                      <Button
                        onClick={() => onFollow(follow === p.id ? null : p.id)}
                      >
                        {follow === p.id ? "Unfollow" : "Follow"}
                      </Button>
                      {s.you.role === "owner" && (
                        <>
                          <Button
                            onClick={() =>
                              send(
                                msg("role_set", {
                                  userId: p.id,
                                  role:
                                    p.role === "viewer" ? "editor" : "viewer",
                                }),
                              )
                            }
                          >
                            {p.role === "viewer"
                              ? "Make editor"
                              : "Make viewer"}
                          </Button>
                          <ConfirmButton
                            label="Kick"
                            onConfirm={() =>
                              send(msg("kick", { userId: p.id }))
                            }
                          />
                          <ConfirmButton
                            label="Ban"
                            onConfirm={() =>
                              send(msg("kick", { userId: p.id, ban: true }))
                            }
                          />
                          <ConfirmButton
                            label="Transfer ownership"
                            onConfirm={() =>
                              send(msg("owner_transfer", { userId: p.id }))
                            }
                          />
                        </>
                      )}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </>
        )}
        {tab === "History" && (
          <>
            <label>
              Version name
              <input
                value={label}
                placeholder="Before the next idea…"
                maxLength={100}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <Button
              disabled={!can(s.you.role, "save", s.settings)}
              onClick={() => {
                if (s.local) {
                  const version = {
                    id: crypto.randomUUID(),
                    label: label || "Saved version",
                    ts: Date.now(),
                    by: s.you.id,
                    elementCount: Object.keys(s.board.elements).length,
                    state: structuredClone(s.board),
                    thumb: thumbnail(s.board),
                  };
                  useWorkspace.setState({ versions: [...s.versions, version] });
                } else
                  send(
                    msg("snap_save", {
                      label: label || "Saved version",
                      thumb: thumbnail(s.board),
                    }),
                  );
                setLabel("");
              }}
            >
              Save version
            </Button>
            {!s.versions.length && (
              <p className="muted">
                Save a moment worth returning to. Automatic safety versions
                appear here too.
              </p>
            )}
            {[...s.versions].reverse().map((v) => (
              <div key={v.id} className="version">
                {v.thumb && <img src={v.thumb} alt={`Preview of ${v.label}`} />}
                <strong>{v.label}</strong>
                <small>
                  {v.auto ? "Automatic · " : ""}
                  {new Date(v.ts).toLocaleString()} · {v.elementCount} elements
                </small>
                <div className="inline-actions">
                  <Button
                    onClick={() =>
                      s.local
                        ? useWorkspace.setState({ preview: v.state })
                        : send(msg("snap_get", { id: v.id }))
                    }
                  >
                    Preview
                  </Button>
                  <ConfirmButton
                    label="Restore"
                    disabled={!can(s.you.role, "restore", s.settings)}
                    onConfirm={() =>
                      s.local
                        ? submit({ kind: "replace_state", state: v.state })
                        : send(msg("snap_restore", { id: v.id }))
                    }
                  />
                  <ConfirmButton
                    label="Delete"
                    disabled={!can(s.you.role, "deleteVersion", s.settings)}
                    onConfirm={() =>
                      s.local
                        ? useWorkspace.setState({
                            versions: s.versions.filter((x) => x.id !== v.id),
                          })
                        : send(msg("snap_delete", { id: v.id }))
                    }
                  />
                </div>
              </div>
            ))}
          </>
        )}
        {tab === "Frames" && (
          <>
            {!s.board.frames.length && (
              <p className="muted">
                Draw frames around parts of the board to build a presentation.
              </p>
            )}
            {s.board.frames.map((id, index) => {
              const el = s.board.elements[id];
              return (
                <div className="frame-item" key={id}>
                  <Button onClick={() => onJump(id)}>
                    <Frame />
                    {el?.title || "Frame " + (index + 1)}
                  </Button>
                  <input
                    aria-label={`Title of frame ${index + 1}`}
                    defaultValue={el?.title || "Frame " + (index + 1)}
                    maxLength={200}
                    onBlur={(e) => {
                      if (e.target.value !== el?.title)
                        submit({
                          kind: "patch",
                          id,
                          set: { title: e.target.value || "Frame" },
                        });
                    }}
                  />
                  <IconButton
                    label="Move frame earlier"
                    disabled={index === 0}
                    onClick={() => {
                      const ids = [...s.board.frames];
                      [ids[index - 1], ids[index]] = [
                        ids[index],
                        ids[index - 1],
                      ];
                      submit({ kind: "frames_order", ids });
                    }}
                  >
                    <ChevronLeft />
                  </IconButton>
                  <IconButton
                    label="Delete frame"
                    onClick={() => submit({ kind: "remove", ids: [id] })}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              );
            })}
          </>
        )}
      </div>
      {tab === "Chat" && (
        <div className="composer">
          <textarea
            aria-label="Message everyone"
            placeholder={
              can(s.you.role, "chat", s.settings)
                ? "Message everyone…"
                : "Chat is disabled"
            }
            disabled={!can(s.you.role, "chat", s.settings)}
            value={chat}
            maxLength={2000}
            onChange={(e) => {
              setChat(e.target.value);
              send(msg("eph", { k: "typing", d: { active: true } }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendChat();
              }
            }}
          />
          <IconButton
            label="Send message"
            disabled={!chat.trim()}
            onClick={sendChat}
          >
            <Send />
          </IconButton>
        </div>
      )}
    </ResizableDock>
  );
}
/** Root owns preferences and editor chrome while the board component owns pointer gestures. */
export function App() {
  const s = useWorkspace();
  const [tool, setTool] = useState<Tool>("pen"),
    [color, setColor] = useState(localStorage.getItem("ink") || "#243E36"),
    [fill, setFill] = useState<string | null>(null),
    [width, setWidth] = useState(3),
    [opacity, setOpacity] = useState(1),
    [dash, setDash] = useState<Element["style"]["dash"]>("solid"),
    [fontSize, setFontSize] = useState(20),
    [route, setRoute] = useState<"straight" | "elbow" | "curve">("straight"),
    [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 }),
    [selected, setSelected] = useState<string[]>([]),
    [dock, setDock] = useState(true),
    [tab, setTab] = useState("Chat"),
    [panel, setPanel] = useState(""),
    [objectQuery, setObjectQuery] = useState(""),
    [objectPage, setObjectPage] = useState(0),
    [theme, setTheme] = useState(localStorage.getItem("theme") || "system"),
    [scale, setScale] = useState(localStorage.getItem("scale") || "1"),
    [contrast, setContrast] = useState(
      localStorage.getItem("contrast") === "true",
    ),
    [minimap, setMinimap] = useState(false),
    [authorship, setAuthorship] = useState(false),
    [follow, setFollow] = useState<string | null>(null),
    [followPresenter, setFollowPresenter] = useState(true),
    [format, setFormat] = useState("png"),
    [scope, setScope] = useState("Entire board"),
    [exportScale, setExportScale] = useState(1),
    [transparent, setTransparent] = useState(false),
    [settingPassword, setSettingPassword] = useState("");
  const file = useRef<HTMLInputElement>(null),
    seedOnJoin = useRef<BoardState | null>(null);
  useEffect(() => {
    const bridge = attachBridge(),
      assets = attachAssets();
    return () => {
      bridge();
      assets();
    };
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    localStorage.setItem("theme", theme);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.style.setProperty("--scale", scale);
    document.documentElement.dataset.scale = scale;
    document.documentElement.dataset.contrast = String(contrast);
    localStorage.setItem("scale", scale);
    localStorage.setItem("contrast", String(contrast));
  }, [scale, contrast]);
  useEffect(() => {
    if (s.entered && !s.local && seedOnJoin.current) {
      const board = seedOnJoin.current;
      seedOnJoin.current = null;
      void (async () => {
        for (const hash of new Set(
          Object.values(board.elements)
            .filter((el) => el.type === "image" && el.assetId)
            .map((el) => el.assetId!),
        )) {
          const data = assetData.get(hash);
          if (data) await uploadImage(hash, data);
        }
        submit({ kind: "replace_state", state: board });
      })();
    }
  }, [s.entered, s.local, s.code]);
  useEffect(() => {
    localStorage.setItem("ink", color);
  }, [color]);
  const fit = () => {
    const b = boardBounds(s.board),
      w = Math.max(
        100,
        (document.querySelector(".board-stage")?.clientWidth || 1000) - 140,
      ),
      h = Math.max(
        100,
        (document.querySelector(".board-stage")?.clientHeight || 600) - 160,
      ),
      z = Math.max(0.1, Math.min(8, Math.min(w / b.w, h / b.h)));
    setViewport({
      zoom: z,
      x: 70 - b.x * z + (w - b.w * z) / 2,
      y: 80 - b.y * z + (h - b.h * z) / 2,
    });
  };
  const jump = (id: string) => {
    const el = s.board.elements[id];
    if (!el) return;
    const w = document.querySelector(".board-stage")?.clientWidth || 1000,
      h = document.querySelector(".board-stage")?.clientHeight || 600,
      z = Math.min(w / ((el.w || 640) + 100), h / ((el.h || 360) + 100));
    setViewport({
      zoom: z,
      x: w / 2 - (el.x + (el.w || 0) / 2) * z,
      y: h / 2 - (el.y + (el.h || 0) / 2) * z,
    });
  };
  const present = (index = 0, active = true) => {
    if (active && !s.board.frames.length) {
      notify("Add a frame before presenting");
      return;
    }
    const p = {
      active,
      frameId: s.board.frames[index],
      index,
      presenterId: s.you.id,
    };
    if (s.local) useWorkspace.setState({ present: p });
    else send(msg("present_set", p));
    if (active) {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) void document.exitFullscreen();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('[role="dialog"],dialog[open]'))
        return;
      if ((e.target as HTMLElement).matches("input,textarea,select")) return;
      if (s.present.active) {
        if (s.present.presenterId !== s.you.id && s.you.role !== "owner") {
          if (e.key === "Escape") setFollowPresenter(false);
          return;
        }
        if (e.key === "Escape") {
          present(0, false);
          return;
        }
        if (["ArrowRight", "ArrowLeft", " "].includes(e.key)) {
          e.preventDefault();
          const next = Math.max(
            0,
            Math.min(
              s.board.frames.length - 1,
              (s.present.index || 0) + (e.key === "ArrowLeft" ? -1 : 1),
            ),
          );
          present(next);
          return;
        }
      }
      if (e.key === "?") {
        setPanel("Shortcuts");
        return;
      }
      if (e.key === "F5") {
        e.preventDefault();
        present();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        fit();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ["+", "=", "-"].includes(e.key)) {
        e.preventDefault();
        setViewport((v) => ({
          ...v,
          zoom: Math.max(
            0.1,
            Math.min(8, v.zoom * (e.key === "-" ? 0.8 : 1.25)),
          ),
        }));
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      const target = tools.find(
        (t) =>
          t.key.toLowerCase() ===
          (e.shiftKey ? "shift+" : "") + e.key.toLowerCase(),
      );
      if (target) {
        setTool(target.id);
        if (target.id === "image") file.current?.click();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [s.present, s.board, dock]);
  const image = async (input: File) => {
    try {
      const asset = await prepareImage(input),
        el = makeElement(
          "image",
          crypto.randomUUID(),
          (150 - viewport.x) / viewport.zoom,
          (150 - viewport.y) / viewport.zoom,
        );
      el.assetId = asset.hash;
      el.natW = asset.w;
      el.natH = asset.h;
      el.w = Math.min(asset.w, 600);
      el.h = (el.w * asset.h) / asset.w;
      el.z = generateKeyBetween(
        Object.values(s.board.elements)
          .map((e) => e.z)
          .sort()
          .at(-1) || null,
        null,
      );
      submit({ kind: "add", el });
    } catch (e) {
      notify(String(e));
    }
  };
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).matches("input,textarea")) return;
      const imageFile = Array.from(e.clipboardData?.files || []).find((f) =>
        f.type.startsWith("image/"),
      );
      if (imageFile) {
        e.preventDefault();
        void image(imageFile);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [viewport, s.board]);
  const patchSelected = (set: Partial<Element>) =>
    submit({
      kind: "batch",
      ops: selected
        .filter((id) => s.board.elements[id])
        .map((id) => ({ kind: "patch", id, set })),
    });
  const settingsPatch = (patch: any) =>
    s.local
      ? useWorkspace.setState({ settings: { ...s.settings, ...patch } })
      : send(msg("settings_update", { patch }));
  const leave = () => {
    send(msg("room_leave", {}));
    void window.canvas.disconnect();
    useWorkspace.setState({
      entered: false,
      local: true,
      status: "idle",
      detail: "",
      code: "LOCAL",
      chat: [],
      participants: [],
    });
    engine.pending = [];
  };
  if (location.hash === "#/design-gallery") return <Gallery />;
  return (
    <>
      {!s.entered ? (
        <Connect />
      ) : (
        <main
          className={`app ${s.present.active && followPresenter ? "presenting" : ""}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) void image(e.dataTransfer.files[0]);
          }}
        >
          <header className="topbar">
            <Wordmark />
            <div className="separator" />
            <span className="room-title" title={s.settings.name}>
              {s.settings.name}
            </span>
            <Button
              className="code"
              onClick={() => {
                void navigator.clipboard.writeText(s.code);
                notify("Room code copied");
              }}
              title={s.address}
            >
              <Copy size={13} />
              {s.code}
            </Button>
            <span className={`status ${s.status === "live" ? "" : "offline"}`}>
              <span className="status-dot" />
              {s.local
                ? "Local board"
                : s.status === "live"
                  ? "Connected"
                  : s.status === "reconnecting"
                    ? "Reconnecting…"
                    : s.status}
            </span>
            <Badge>{s.you.role}</Badge>
            <div className="spacer" />
            <div className="avatars">
              {s.participants.slice(0, 4).map((p) => (
                <Avatar key={p.id} name={p.username} color={p.color} />
              ))}
            </div>
            <IconButton
              label="Undo (Ctrl+Z)"
              disabled={!history.canUndo}
              onClick={() => undo()}
            >
              <Undo2 />
            </IconButton>
            <IconButton
              label="Redo (Ctrl+Shift+Z)"
              disabled={!history.canRedo}
              onClick={() => undo(true)}
            >
              <Redo2 />
            </IconButton>
            <div className="separator" />
            <Button aria-label="Export" onClick={() => setPanel("Export")}>
              <Download />
              <span className="label-secondary">Export</span>
            </Button>
            <IconButton
              label="Version history"
              onClick={() => {
                setDock(true);
                setTab("History");
              }}
            >
              <History />
            </IconButton>
            <IconButton
              label="Start presentation (F5)"
              disabled={!can(s.you.role, "present", s.settings)}
              onClick={() => present()}
            >
              <Presentation />
            </IconButton>
            <IconButton
              label="Canvas objects"
              onClick={() => setPanel("Objects")}
            >
              <Layers />
            </IconButton>
            <IconButton
              label="Workspace settings"
              onClick={() => setPanel("Settings")}
            >
              <SettingsIcon />
            </IconButton>
            <IconButton
              label="Toggle collaboration panel"
              active={dock}
              onClick={() => setDock(!dock)}
            >
              <Users />
            </IconButton>
            <IconButton label="Leave workspace" onClick={leave}>
              <LogOut />
            </IconButton>
          </header>
          {s.toast.length > 0 && (
            <div
              className="notification-strip"
              role="status"
              aria-live="polite"
            >
              {s.toast.at(-1)}
            </div>
          )}
          {!s.local && s.status !== "live" && (
            <div className="banner">
              {s.status === "kicked"
                ? "You were removed from the room."
                : `Offline — ${s.pending} changes waiting. Keep working; changes will sync when the server returns.`}
              {s.detail && <span>{s.detail}</span>}
            </div>
          )}
          {s.preview && (
            <div className="banner">
              Previewing a saved version. Drawing is paused.
              <Button onClick={() => useWorkspace.setState({ preview: null })}>
                Return to live board
              </Button>
            </div>
          )}
          {follow && (
            <div className="banner">
              Following {s.participants.find((p) => p.id === follow)?.username}
              <Button onClick={() => setFollow(null)}>Stop following</Button>
            </div>
          )}
          <div className={`workspace ${dock ? "has-dock" : ""}`}>
            <BoardCanvas
              tool={tool}
              color={color}
              fill={fill}
              width={width}
              opacity={opacity}
              dash={dash}
              fontSize={fontSize}
              route={route}
              viewport={viewport}
              setViewport={setViewport}
              selected={selected}
              setSelected={setSelected}
              minimap={minimap}
              authorship={authorship}
              follow={follow}
              followPresenter={followPresenter}
              onTool={setTool}
              onImage={() => file.current?.click()}
            />
            <nav className="rail" aria-label="Drawing tools">
              {tools.map((t, index) => (
                <div key={t.id}>
                  {[2, 6, 11, 15].includes(index) && (
                    <div className="rail-divider" />
                  )}
                  <IconButton
                    label={`${t.label}${t.key ? " (" + t.key + ")" : ""}`}
                    active={tool === t.id}
                    disabled={
                      !can(s.you.role, "draw", s.settings) &&
                      !["hand", "select"].includes(t.id)
                    }
                    onClick={() => {
                      setTool(t.id);
                      if (t.id === "image") file.current?.click();
                    }}
                  >
                    {t.icon}
                  </IconButton>
                </div>
              ))}
              <IconButton
                label="Keyboard shortcuts (?)"
                onClick={() => setPanel("Shortcuts")}
              >
                <HelpCircle />
              </IconButton>
            </nav>
            <div
              className="properties"
              data-tool={tool}
              aria-label="Tool properties"
            >
              <SelectionProperties ids={selected} />
              <ColorSwatchPicker
                value={color}
                onChange={(v) => {
                  setColor(v);
                  if (selected.length)
                    for (const id of selected) {
                      const el = s.board.elements[id];
                      if (el)
                        submit({
                          kind: "patch",
                          id,
                          set: { style: { stroke: v } },
                        });
                    }
                }}
              />
              <Slider
                label="Width"
                value={width}
                min={1}
                max={40}
                onChange={setWidth}
              />
              <label>
                Fill
                <input
                  aria-label="Fill color"
                  type="color"
                  value={fill || "#ffffff"}
                  onChange={(e) => setFill(e.target.value)}
                />
              </label>
              <Button onClick={() => setFill(null)}>No fill</Button>
              <select
                aria-label="Dash pattern"
                value={dash}
                onChange={(e) => setDash(e.target.value as any)}
              >
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
              {["text", "sticky", "mindnode"].includes(tool) && (
                <input
                  type="number"
                  aria-label="Font size"
                  style={{ width: 65 }}
                  min={8}
                  max={200}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                />
              )}
              <details>
                <summary>More</summary>
                <div className="inline-actions">
                  <Slider
                    label="Opacity"
                    min={0.1}
                    max={1}
                    step={0.1}
                    value={opacity}
                    onChange={setOpacity}
                  />
                  <select
                    aria-label="Additional shapes"
                    value={tool}
                    onChange={(e) => setTool(e.target.value as Tool)}
                  >
                    <option value="rect">Rectangle / process</option>
                    <option value="roundrect">Rounded / terminator</option>
                    <option value="diamond">Diamond / decision</option>
                    <option value="parallelogram">Input / output</option>
                    <option value="hexagon">Document-like block</option>
                    <option value="triangle">Triangle</option>
                  </select>
                  <select
                    aria-label="Connector route"
                    value={route}
                    onChange={(e) => setRoute(e.target.value as any)}
                  >
                    <option value="straight">Straight</option>
                    <option value="elbow">Elbow</option>
                    <option value="curve">Curve</option>
                  </select>
                  {selected.length > 0 && (
                    <>
                      <IconButton
                        label="Rotate selection"
                        onClick={() => {
                          for (const id of selected)
                            submit({
                              kind: "patch",
                              id,
                              set: {
                                angle:
                                  (s.board.elements[id]?.angle || 0) +
                                  Math.PI / 12,
                              },
                            });
                        }}
                      >
                        <RotateCw />
                      </IconButton>
                      <IconButton
                        label="Lock or unlock selection"
                        onClick={() =>
                          patchSelected({
                            locked: !selected.every(
                              (id) => s.board.elements[id]?.locked,
                            ),
                          })
                        }
                      >
                        <Lock />
                      </IconButton>
                      <IconButton
                        label="Bring to front"
                        onClick={() => {
                          let z =
                            Object.values(s.board.elements)
                              .map((e) => e.z)
                              .sort()
                              .at(-1) || null;
                          for (const id of selected) {
                            z = generateKeyBetween(z, null);
                            submit({ kind: "patch", id, set: { z } });
                          }
                        }}
                      >
                        <Layers />
                      </IconButton>
                      <IconButton
                        label="Align left"
                        onClick={() => {
                          const x = Math.min(
                            ...selected.map((id) => s.board.elements[id].x),
                          );
                          patchSelected({ x });
                        }}
                      >
                        <AlignLeft />
                      </IconButton>
                      <IconButton
                        label="Delete selected"
                        onClick={() => {
                          submit({ kind: "remove", ids: selected });
                          setSelected([]);
                        }}
                      >
                        <Trash2 />
                      </IconButton>
                    </>
                  )}
                  <ConfirmButton
                    label="Clear board"
                    disabled={!can(s.you.role, "clear", s.settings)}
                    onConfirm={() => submit({ kind: "clear" })}
                  />
                </div>
              </details>
            </div>
            <div className="viewport-controls">
              <IconButton
                label="Zoom out"
                onClick={() =>
                  setViewport({
                    ...viewport,
                    zoom: Math.max(0.1, viewport.zoom * 0.8),
                  })
                }
              >
                <Minus />
              </IconButton>
              <Button onClick={fit}>{Math.round(viewport.zoom * 100)}%</Button>
              <IconButton
                label="Zoom in"
                onClick={() =>
                  setViewport({
                    ...viewport,
                    zoom: Math.min(8, viewport.zoom * 1.25),
                  })
                }
              >
                <Plus />
              </IconButton>
              <IconButton label="Fit board (Ctrl+0)" onClick={fit}>
                <Maximize />
              </IconButton>
              <IconButton
                label="Toggle minimap"
                active={minimap}
                onClick={() => setMinimap(!minimap)}
              >
                <Map />
              </IconButton>
            </div>
            <div className="statusbar">
              {s.imageProgress !== null && (
                <span>Uploading image… {s.imageProgress}%</span>
              )}
              <span>
                {tools.find((t) => t.id === tool)?.label || tool} ·{" "}
                {selected.length
                  ? selected.length + " selected"
                  : Object.keys(s.board.elements).length + " elements"}
              </span>
              <span>
                {s.local
                  ? "Saved on this device"
                  : `${s.address} · ${s.rtt} ms · ${s.pending ? "Syncing " + s.pending + " changes" : "All changes synced"}`}
              </span>
            </div>
            {dock && (
              <Dock
                tab={tab}
                setTab={setTab}
                onClose={() => setDock(false)}
                follow={follow}
                onFollow={setFollow}
                onJump={jump}
              />
            )}
            {s.present.active && (
              <div className="present-bar">
                <Switch
                  label="Follow presenter"
                  checked={followPresenter}
                  onChange={setFollowPresenter}
                />
                <IconButton
                  label="Previous slide"
                  disabled={
                    s.present.presenterId !== s.you.id && s.you.role !== "owner"
                  }
                  onClick={() =>
                    present(Math.max(0, (s.present.index || 0) - 1))
                  }
                >
                  <ChevronLeft />
                </IconButton>
                <span>
                  {(s.present.index || 0) + 1} / {s.board.frames.length}
                </span>
                <IconButton
                  label="Next slide"
                  disabled={
                    s.present.presenterId !== s.you.id && s.you.role !== "owner"
                  }
                  onClick={() =>
                    present(
                      Math.min(
                        s.board.frames.length - 1,
                        (s.present.index || 0) + 1,
                      ),
                    )
                  }
                >
                  <ChevronRight />
                </IconButton>
                <Button
                  disabled={
                    s.present.presenterId !== s.you.id && s.you.role !== "owner"
                  }
                  onClick={() => present(0, false)}
                >
                  End presentation
                </Button>
              </div>
            )}
          </div>
        </main>
      )}
      <input
        hidden
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          if (e.target.files?.[0]) void image(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {panel && (
        <Panel
          title={panel === "Settings" ? "Workspace settings" : panel}
          onClose={() => setPanel("")}
        >
          {panel === "Objects" && (
            <div className="settings">
              <label>
                Find an object
                <input
                  value={objectQuery}
                  onChange={(e) => {
                    setObjectQuery(e.target.value);
                    setObjectPage(0);
                  }}
                  placeholder="Search text, type, author, or ID"
                />
              </label>
              <p className="muted">
                Choose an object to focus it on the canvas. Use arrow keys to
                move it, Ctrl+D to duplicate, Delete to remove, or Escape to
                deselect.
              </p>
              <ul className="object-list">
                {Object.values(s.board.elements)
                  .filter((el) =>
                    `${el.type} ${el.text || el.title || ""} ${el.authorName} ${el.id}`
                      .toLowerCase()
                      .includes(objectQuery.toLowerCase()),
                  )
                  .slice(objectPage * 100, (objectPage + 1) * 100)
                  .map((el) => (
                    <li key={el.id}>
                      <Button
                        onClick={() => {
                          setSelected([el.id]);
                          jump(el.id);
                          setPanel("");
                          requestAnimationFrame(() =>
                            document
                              .querySelector<HTMLCanvasElement>(
                                "canvas[aria-label]",
                              )
                              ?.focus(),
                          );
                        }}
                      >
                        {el.type}: {(el.text || el.title || el.id).slice(0, 80)}{" "}
                        · {el.authorName}
                      </Button>
                    </li>
                  ))}
              </ul>
              <div className="inline-actions">
                <Button
                  disabled={objectPage === 0}
                  onClick={() => setObjectPage((p) => p - 1)}
                >
                  Previous 100
                </Button>
                <Button
                  disabled={
                    (objectPage + 1) * 100 >=
                    Object.values(s.board.elements).filter((el) =>
                      `${el.type} ${el.text || el.title || ""} ${el.authorName} ${el.id}`
                        .toLowerCase()
                        .includes(objectQuery.toLowerCase()),
                    ).length
                  }
                  onClick={() => setObjectPage((p) => p + 1)}
                >
                  Next 100
                </Button>
              </div>
            </div>
          )}
          {panel === "Settings" && (
            <div className="settings">
              <h3>Appearance</h3>
              <label>
                Preferred identity color for your next room
                <select
                  defaultValue={localStorage.getItem("identityColorHint") || ""}
                  onChange={(e) =>
                    localStorage.setItem("identityColorHint", e.target.value)
                  }
                >
                  <option value="">Assign automatically</option>
                  {IDENTITY_COLORS.map((color, index) => (
                    <option key={color} value={color}>
                      {
                        [
                          "Blue",
                          "Orange",
                          "Green",
                          "Rose",
                          "Ochre",
                          "Violet",
                          "Teal",
                          "Red",
                          "Olive",
                          "Brown",
                          "Cornflower",
                          "Mauve",
                        ][index]
                      }
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Theme
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label>
                UI scale
                <select
                  value={scale}
                  onChange={(e) => setScale(e.target.value)}
                >
                  <option value="1">100%</option>
                  <option value="1.25">125%</option>
                  <option value="1.5">150%</option>
                </select>
              </label>
              <Switch
                label="Projector-friendly high contrast"
                checked={contrast}
                onChange={setContrast}
              />
              <Switch
                label="Show authorship"
                checked={authorship}
                onChange={setAuthorship}
              />
              <h3>Room controls</h3>
              <label>
                Workspace name
                <input
                  value={s.settings.name}
                  disabled={s.you.role !== "owner"}
                  onChange={(e) =>
                    settingsPatch({ name: e.target.value || "Workspace" })
                  }
                />
              </label>
              {(
                [
                  "requireApproval",
                  "editorsCanClear",
                  "editorsCanPresent",
                  "chatEnabled",
                  "boardLocked",
                ] as const
              ).map((key, index) => (
                <Switch
                  key={key}
                  label={
                    [
                      "Approve join requests",
                      "Editors can clear and restore",
                      "Editors can present",
                      "Enable chat",
                      "Protect workspace",
                    ][index]
                  }
                  checked={s.settings[key]}
                  disabled={s.you.role !== "owner"}
                  onChange={(v) => settingsPatch({ [key]: v })}
                />
              ))}
              <label>
                Default role
                <select
                  value={s.settings.defaultRole}
                  disabled={s.you.role !== "owner"}
                  onChange={(e) =>
                    settingsPatch({ defaultRole: e.target.value })
                  }
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </label>
              {s.you.role === "owner" && !s.local && (
                <>
                  <label>
                    Set or change room password
                    <input
                      type="password"
                      value={settingPassword}
                      onChange={(e) => setSettingPassword(e.target.value)}
                    />
                  </label>
                  <div className="inline-actions">
                    <Button
                      onClick={() => {
                        settingsPatch({ password: settingPassword });
                        setSettingPassword("");
                        notify("Room password updated");
                      }}
                    >
                      Update password
                    </Button>
                    <Button onClick={() => settingsPatch({ password: "" })}>
                      Remove password
                    </Button>
                  </div>
                </>
              )}
              {s.local && (
                <Button
                  primary
                  onClick={() => {
                    seedOnJoin.current = structuredClone(s.board);
                    leave();
                    setPanel("");
                    notify("Create a server room to share this local board");
                  }}
                >
                  Share to a server
                </Button>
              )}
            </div>
          )}
          {panel === "Shortcuts" && (
            <div className="shortcut-list">
              {tools
                .filter((t) => t.key)
                .map((t) => (
                  <span key={t.id}>
                    {t.label}
                    <Kbd>{t.key}</Kbd>
                  </span>
                ))}
              {[
                ["Undo", "Ctrl Z"],
                ["Redo", "Ctrl Shift Z"],
                ["Pan", "Space + drag"],
                ["Fit board", "Ctrl 0"],
                ["Duplicate", "Ctrl D"],
                ["Group / ungroup", "Ctrl G / Ctrl Shift G"],
                ["Add child idea", "Tab"],
                ["Add sibling idea", "Enter"],
                ["Present", "F5"],
              ].map(([label, key]) => (
                <span key={label}>
                  {label}
                  <Kbd>{key}</Kbd>
                </span>
              ))}
            </div>
          )}
          {panel === "Export" && (
            <div className="settings">
              <label>
                Format
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  {["png", "svg", "pdf", "wbboard"].map((f) => (
                    <option key={f} value={f}>
                      {f === "wbboard"
                        ? "Canvas board (.wbboard)"
                        : f.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Area
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  {[
                    "Entire board",
                    "Each frame",
                    "Viewport",
                    "Selection",
                    ...s.board.frames.map((id) => "Frame: " + id),
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Resolution
                <select
                  value={exportScale}
                  onChange={(e) => setExportScale(Number(e.target.value))}
                >
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                </select>
              </label>
              <Switch
                label="Transparent background"
                checked={transparent}
                onChange={setTransparent}
              />
              <Button
                primary
                onClick={() => {
                  if (scope === "Each frame") {
                    void exportFrames(s.board, format, exportScale, transparent)
                      .then((saved) => {
                        if (saved) notify("Frame exports saved");
                      })
                      .catch((e) => notify(String(e)));
                    return;
                  }
                  let state = s.board,
                    region;
                  if (scope === "Selection")
                    state = {
                      ...state,
                      elements: Object.fromEntries(
                        selected.map((id) => [id, state.elements[id]]),
                      ),
                    };
                  if (scope === "Viewport")
                    region = {
                      x: -viewport.x / viewport.zoom,
                      y: -viewport.y / viewport.zoom,
                      w: (document.querySelector('.board-stage')?.clientWidth || 1000) / viewport.zoom,
                      h: (document.querySelector('.board-stage')?.clientHeight || 600) / viewport.zoom,
                    };
                  if (scope.startsWith("Frame: ")) {
                    const el = state.elements[scope.slice(7)];
                    region = { x: el.x, y: el.y, w: el.w!, h: el.h! };
                  }
                  void exportBoard(
                    state,
                    format,
                    exportScale,
                    transparent,
                    region,
                  )
                    .then((saved) => {
                      if (saved) notify("Export saved");
                    })
                    .catch((e) => notify(String(e)));
                }}
              >
                Save export
                <Download />
              </Button>
              <Button
                disabled={!s.local && s.you.role !== "owner"}
                onClick={async () => {
                  try {
                    const text = await window.canvas.open();
                    if (!text) return;
                    const file = parseBoardFile(text);
                    for (const [hash, data] of Object.entries(file.assets)) {
                      cacheImage(hash, data);
                      await uploadImage(hash, data);
                    }
                    submit({ kind: "replace_state", state: file.state });
                    setPanel("");
                  } catch (e) {
                    notify(String(e));
                  }
                }}
              >
                Import a Canvas board
              </Button>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
