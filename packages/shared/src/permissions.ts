/** A centralized policy shared by server enforcement and disabled client controls. */
import type { Participant, Settings } from "./protocol";
/** Actions deliberately distinguish import from ordinary drawing. */
export type Action =
  | "draw"
  | "clear"
  | "chat"
  | "save"
  | "restore"
  | "deleteVersion"
  | "import"
  | "manage"
  | "present";
/** Owners retain recovery controls even when the workspace is locked. */
export function can(role: Participant["role"], action: Action, s: Settings) {
  if (role === "owner") return action !== "chat" || s.chatEnabled;
  if (action === "manage" || action === "import") return false;
  if (action === "chat")
    return s.chatEnabled && (role !== "viewer" || !s.viewerChatMuted);
  if (role === "viewer" || s.boardLocked) return false;
  if (action === "clear" || action === "restore") return s.editorsCanClear;
  if (action === "present") return s.editorsCanPresent;
  return action === "draw" || action === "save";
}
