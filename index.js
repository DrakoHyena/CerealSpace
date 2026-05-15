const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");

const PORT = 3000;
const activeServers = new Map(); // Map<serverId, Set<WebSocket>>

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function serveStaticFile(req, res) {
  const pathname = req.url?.split("?")[0] || "/";
  const initialPath = pathname === "/" ? "/client/index.html" : pathname;

  const primaryPath = path.join(__dirname, initialPath);
  const fallbackPath = path.join(__dirname, "client", pathname);
  const safeBase = path.normalize(__dirname);

  if (
    !path.normalize(primaryPath).startsWith(safeBase) ||
    !path.normalize(fallbackPath).startsWith(safeBase)
  ) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  const tryPath = (filePath) => {
    fs.stat(filePath, (err, stats) => {
      if (err) {
        if (
          err.code === "ENOENT" &&
          filePath === primaryPath &&
          primaryPath !== fallbackPath
        ) {
          return tryPath(fallbackPath);
        }
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("Not Found");
      }

      const etag = `"${crypto.createHash("sha1").update(`${stats.mtime.getTime()}-${stats.size}`).digest("base64")}"`;

      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304);
        return res.end();
      }

      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      res.setHeader(
        "Content-Type",
        MIME_TYPES[path.extname(filePath)] || "text/plain",
      );
      res.setHeader("ETag", etag);
      res.writeHead(200);

      fs.createReadStream(filePath).pipe(res);
    });
  };

  tryPath(primaryPath);
}

const rooms = {};
const conns = new Map();

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.startsWith("/api/servers")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(rooms));
  }
  serveStaticFile(req, res);
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "SIGNAL_SOCKET_ID", socketId: ws.socketId }));

  ws.on("message", (msg) => {
    try {
      const dat = JSON.parse(msg);

      switch (dat.type) {
        case "SIGNAL_HOST_ICE_SERVERS":
          if (ws.isHost !== true) return;
          rooms[ws.socketId].iceServers = dat.servers?.length
            ? dat.servers
            : [{ urls: "stun:stun.l.google.com:19302" }];
          break;
        default:
          let targWs = conns.get(dat.target);
          if (!targWs) return;
          dat.from = ws.socketId;
          targWs.send(JSON.stringify(dat));
          break;
      }
    } catch (e) {
      console.error(e);
    }
  });

  ws.on("close", () => {
    if (ws.isHost) {
      delete rooms[ws.socketId];
    }
    conns.delete(ws.socketId);
  });
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const isHost = url.pathname === "/host";
  const serverId = url.searchParams.get("id");

  if (!isHost && !rooms[serverId]) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    return socket.destroy();
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.socketId = crypto.randomUUID();
    ws.isHost = isHost;
    conns.set(ws.socketId, ws);
    if (isHost)
      rooms[ws.socketId] = {
        created: Date.now(),
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      };

    wss.emit("connection", ws);
  });
});

server.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
