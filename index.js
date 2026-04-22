// =================================================================
// 1. DEPENDENCIES - All requires from both servers
// =================================================================
const http = require("http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto"); // <<< ADDED for TURN credentials

const PORT = 3000;

// =================================================================
// 3. COMBINED SERVER CREATION
// =================================================================

// Static file serving constants
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

/**
 * Handles serving static files with ETag-based caching and 304 Not Modified responses.
 * @param {http.IncomingMessage} req The request object.
 * @param {http.ServerResponse} res The response object.
 */
function serveStaticFile(req, res) {
  const pathname = req.url?.split("?")[0] || "/";
  const initialPath = pathname === "/" ? "/client/index.html" : pathname;

  // Define primary and fallback paths based on original logic
  const primaryPath = path.join(__dirname, initialPath);
  const fallbackPath = path.join(__dirname, "client", pathname);

  // Security: Normalize paths and ensure they are within the project directory
  const safeBase = path.normalize(__dirname);
  if (
    !path.normalize(primaryPath).startsWith(safeBase) ||
    !path.normalize(fallbackPath).startsWith(safeBase)
  ) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  const tryPath = (filePath) => {
    fs.stat(filePath, (statErr, stats) => {
      // Handle file not found or other errors
      if (statErr) {
        // If the primary path failed and there's a different fallback path, try it.
        if (
          statErr.code === "ENOENT" &&
          filePath === primaryPath &&
          primaryPath !== fallbackPath
        ) {
          tryPath(fallbackPath);
        } else {
          // All attempts failed
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        }
        return;
      }

      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

      // Generate a strong ETag from file stats. ETags must be quoted.
      const etag = `"${crypto.createHash("sha1").update(`${stats.mtime.getTime()}-${stats.size}`).digest("base64")}"`;

      // Check if the browser sent an ETag and if it matches our current one.
      if (req.headers["if-none-match"] === etag) {
        console.log(`[304 Not Modified] ${pathname}`);
        res.writeHead(304);
        res.end();
        return;
      }

      // File has changed or is being requested for the first time.
      // Set headers and send the file via a memory-efficient stream.
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || "text/plain";

      res.setHeader("Content-Type", contentType);
      res.setHeader("ETag", etag);
      // 'no-cache' instructs the client to always re-validate with the server, enabling the 304 response.
      //res.setHeader("Cache-Control", "max-age=3600, must-revalidate" )
      res.writeHead(200);
      fs.createReadStream(filePath).pipe(res);
    });
  };

  tryPath(primaryPath);
}

// The main request handler that decides what to do with each request
const handleRequest = (req, res) => {
  serveStaticFile(req, res);
};

const server = http.createServer(handleRequest);

// =================================================================
// 5. START THE SERVER
// =================================================================

server.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
  console.log(
    `   - Serving static files from: ${path.join(__dirname, "client")}`,
  );
});
