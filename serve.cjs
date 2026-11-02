// Development only. Nothing outside site/ is served or published.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.join(__dirname, "site");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8" };

const server = http.createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost:8000").pathname);
    const file = await fs.realpath(path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname)));
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const content = await fs.readFile(file);
    response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    response.writeHead(error instanceof URIError ? 400 : 404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("This page could not be found. Check the address and try again.");
  }
});
server.on("error", (error) => { console.error(error.code === "EADDRINUSE" ? "Port 8000 is already in use. Stop the other preview and try again." : "The preview could not start. Check your local network settings and try again."); process.exitCode = 1; });
server.listen(8000, "localhost", () => console.log("Preview: http://localhost:8000 — press Ctrl+C to stop."));
