# Offline verification

Use Node 22 for development or native packaged executables for a standalone demo.

1. Run `canvas-server-win-x64.exe --host 0.0.0.0 --port 5050 --data ./data` (or `npm run dev:server -- --host 0.0.0.0`). Allow Windows Firewall access on the private network when prompted. Do not expose the port through a router.
2. Start three Canvas instances with separate `--user-data-dir` values. The app has no single-instance lock. Connect to `127.0.0.1:5050` on one machine, or the printed private IPv4 address on another machine.
3. Create a room; join with the code on the other two clients. Test password, approval, viewer role, chat and drawing. Compare saved `.wbboard` state hashes. Disconnect the internet uplink while retaining the private LAN; repeat with all networking disabled on loopback.
4. Draw simultaneously, join late, undo only your own work, erase, clear, save/preview/restore versions. Verify participants and cursors. Use each additional tool from §6 of plan.md.
5. Stop the server, draw offline, restart it, and confirm pending changes synchronize once. Restart a client and resume its pending queue. Restore a safety version.
6. Export PNG/SVG/PDF/Canvas board and open each output. Open the Canvas board as local mode and share it to a server.
7. Inspect Electron request logs: packaged resources must all use `file:`, `data:` or `blob:`; networking is restricted to raw private-address TCP and UDP discovery. Development Vite traffic is not a packaged runtime dependency.

If connection fails, check the exact IP/port, that both machines are on the same private network, the server is bound to `0.0.0.0`, and inbound TCP 5050 / UDP 5051 are allowed in Windows Firewall. Do not disable the firewall.

This is an execution checklist, not evidence that a physical LAN or disabled-network test has already passed. Record the machine/platform and results in PROGRESS.md.
