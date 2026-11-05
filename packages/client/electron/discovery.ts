/** UDP discovery is local broadcast only; board data always uses TCP. */
import { createSocket } from "node:dgram";
/** Collect bounded discovery replies for one second and release the socket. */
export function discover(): Promise<unknown[]> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4"),
      found = new Map<string, unknown>();
    const finish = () => {
      try {
        socket.close();
      } catch {
        /* Already closed on error. */
      }
      resolve([...found.values()]);
    };
    socket.on("error", finish);
    socket.on("message", (bytes, remote) => {
      if (bytes.length > 2048) return;
      try {
        const data = JSON.parse(bytes.toString());
        if (typeof data.name === "string" && Number.isInteger(data.tcpPort))
          found.set(remote.address, { ...data, host: remote.address });
      } catch {
        /* Ignore unrelated LAN broadcasts. */
      }
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send("WB_DISCOVER/1", 5051, "255.255.255.255");
      socket.send("WB_DISCOVER/1", 5051, "127.0.0.1");
    });
    const timer = setTimeout(finish, 1000);
    timer.unref();
  });
}
