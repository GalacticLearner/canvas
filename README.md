# Canvas

Canvas is a standalone collaborative whiteboard for a local network. Board traffic uses raw TCP sockets; UDP is used only to discover nearby servers. Fonts, icons, exports and images work locally, without accounts or online services.

## Run on Windows

1. Start `dist/executables/canvas-server-win-x64.exe`. Keep its console open. The default listening ports are TCP **5050** and UDP **5051**.
2. Open `dist/installers/Canvas-0.1.0-windows-x64.exe` on each computer. This is the portable client; installation is unnecessary.
3. Enter the server's printed private IPv4 address and port. On the server computer itself, use `127.0.0.1:5050`.
4. Create a workspace, share its six-character code, and have other participants choose **Join room**.

Allow the server through Windows Firewall on your private network. A typical explicit launch is:

```powershell
.\dist\executables\canvas-server-win-x64.exe --host 0.0.0.0 --port 5050 --data .\data
```

This host's Application Control policy blocks execution of the unsigned server executable. The same server is tested through Node; the policy was not changed. If your machine also blocks the executable, install Node 22 and use:

```powershell
node .\dist\server.cjs --host 0.0.0.0 --port 5050 --data .\data
```

The client accepts private numeric LAN addresses, loopback and `localhost`. The server owns persistent room data; the client stores preferences, recovery credentials, image caches and pending edits in its application data directory. Protect these directories as you would the board content.

## Tools and collaboration

The drawing rail provides selection, pan, pen, highlighter, object and pixel erasers, shapes, connectors, polylines, text, sticky notes, mind maps, images and frames. Properties control color, fill, line style, opacity and typography. Selection supports resizing, rotation, snapping, grouping, arranging, alignment, distribution, locking and duplication. **Canvas objects** provides searchable keyboard access to existing content.

Drag a selected shape's anchor to connect it to another shape or create a connected node. Connector endpoints follow their shapes. Mind maps support Tab for a child, Enter for a sibling, Delete for a subtree and Space for collapse; Shift+Tab adds a left branch. Text editing uses temporary collaborative locks.

The collaboration dock contains Chat, People, History and Frames. Owners can approve joins, assign roles, lock the board, set a password, kick or ban participants and transfer ownership. Versions include automatic safety copies before destructive operations. Follow another participant from People, or present an ordered sequence of frames with a shared laser pointer.

**Export** supports PNG, SVG, PDF and `.wbboard`, with board/viewport/selection/frame regions, raster resolution and transparency controls. `.wbboard` embeds the board's referenced images and can be imported or opened offline. **Work offline** creates a local board; **Share to a server** turns it into a collaborative workspace. Disconnected rooms remain editable and queued edits synchronize on reconnect.

Settings include system/light/dark themes, high contrast, 100/125/150% UI scaling, a preferred identity color and remembered connection details. Press **?** for the shortcut list. Ctrl+Z undoes your own gestures; Ctrl+Shift+Z or Ctrl+Y redoes them. Ctrl+0 fits the board.

## All extra-credit features

| IDs | Features |
| --- | --- |
| A1–A4 | Lines/shapes, bound flowcharts, mind maps, sticky notes |
| A5–A8 | Image insertion, text, selection/transforms/groups/layers, frames |
| A9–A12 | Presentations, roles, version history, PNG/SVG/PDF/board exports |
| A13–A16 | Offline/local/share workflows, UDP discovery, authorship/follow, text locks |
| A17–A20 | Shortcuts/preferences, themes/scaling/contrast, console/stats, seeder/bots |

## Server console and demo

Type `rooms`, `clients`, `stats`, `kick <code> <user-id>`, `close <code>` or `quit` in the server console. `--help` lists startup flags. Custom UDP ports are supported through `--discovery-port`; clients discover on the standard 5051 port, so use the address field for a custom-port server.

From a source checkout with dependencies installed:

```powershell
npm run seed -- --server 127.0.0.1:5050 --bots 5
```

Omit `--room` to create a demo workspace. The seeder inserts a flowchart, mind map, sticky, shapes, frame, stroke, bundled sample image and chat. Bots continue drawing until the process is stopped.

## Build and verify

Use Node **22 LTS** and npm. Install dependencies once with internet available; runtime requires no downloads.

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run package:server
npm run package:client
npm run package:source
```

For development, run `npm run dev:server` and `npm run dev:client` in separate terminals. For several client instances, pass distinct `--user-data-dir=<absolute-path>` arguments to Electron; `--name=<label>` supplies a display-name default.

Native CI jobs prepare Windows portable, Linux AppImage and macOS DMG clients plus server binaries. Linux/macOS execution is pending native runners; those artifacts have not been tested on this Windows host.

Validation evidence is in `design/screens/` and generated `dist/evidence/`. The automated suite exercises protocol framing, reducer/undo, real TCP collaboration, permissions, authentication, persistence, assets, recovery and sync faults. Three actual Electron clients verify matching boards, content tools, chat, history, presentations, keyboard access and zero HTTP requests. Load evidence is loopback measurement, not physical-LAN measurement. See `PROGRESS.md` for exact accepted steps and `BLOCKERS.md` for outstanding environmental checks; do not interpret build success as completion of those checks.

The physical-LAN and internet-disabled procedure is in `scripts/offline-verify.md`. No network adapter or machine security policy was changed during development.

## Source and licenses

`packages/shared` defines the sole protocol/model/reducer authority; `packages/server` is the TCP authority; `packages/client` contains Electron's socket bridge and React/Canvas editor. `tools` contains headless clients, a fault proxy, load/recovery/performance checks and demo content. `THIRD_PARTY.txt` inventories dependencies and licenses; bundled Electron distributions include their runtime notices.
