"use strict";
/**
 * Serveur de test local : site statique (dist/) + fonctions /api, branchés sur un
 * PostgreSQL LOCAL. Sert aux tests de navigateur (Playwright). Jamais Neon.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml", ".webmanifest": "application/manifest+json" };

function start(dist, port = 0) {
  const routes = {
    "/api/contact": require("../api/contact"), "/api/newsletter": require("../api/newsletter"),
    "/api/views": require("../api/views"), "/api/media": require("../api/media"), "/api/admin": require("../api/admin"), "/api/health": require("../api/health"),
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/media/")) { req.url = `/api/media?id=${u.pathname.slice(7)}`; return routes["/api/media"](req, res); }
    const key = Object.keys(routes).find((k) => u.pathname === k || u.pathname.startsWith(k + "/"));
    if (key) {
      if (key === "/api/newsletter" && u.pathname !== key) req.url = `${key}?action=${u.pathname.split("/").pop()}`;
      if (key === "/api/admin" && u.pathname !== key) req.url = `${key}?route=${u.pathname.slice(key.length + 1)}${u.search ? "&" + u.search.slice(1) : ""}`;
      return routes[key](req, res);
    }
    let p = decodeURIComponent(u.pathname);
    const cands = [p, p + ".html", path.join(p, "index.html")];
    for (const c of cands) {
      const full = path.join(dist, c);
      if (full.startsWith(dist) && fs.existsSync(full) && fs.statSync(full).isFile()) {
        res.setHeader("Content-Type", MIME[path.extname(full)] || "application/octet-stream");
        return res.end(fs.readFileSync(full));
      }
    }
    res.statusCode = 404; res.end("404");
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}
module.exports = { start };
