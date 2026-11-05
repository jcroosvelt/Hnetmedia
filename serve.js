#!/usr/bin/env node
/* Serveur local zéro dépendance, avec URLs propres (/politique → politique.html).
   Usage : node serve.js [port]   (sert le dossier dist/) */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const DIST = path.join(__dirname, "dist");
const PORT = process.argv[2] || 8000;
const TYPES = { ".html":"text/html; charset=utf-8", ".css":"text/css", ".js":"text/javascript", ".json":"application/json", ".xml":"application/xml", ".png":"image/png", ".svg":"image/svg+xml", ".ico":"image/x-icon", ".txt":"text/plain", ".webmanifest":"application/manifest+json" };
function resolve(urlPath) {
  const p = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[\/\\])+/, "");
  const candidates = [p, p + ".html", path.join(p, "index.html")];
  for (const c of candidates) {
    const f = path.join(DIST, c);
    if (f.startsWith(DIST) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}
http.createServer((req, res) => {
  const file = resolve(req.url.split("?")[0]);
  if (file) { res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }); return fs.createReadStream(file).pipe(res); }
  res.writeHead(404, { "Content-Type": TYPES[".html"] });
  fs.createReadStream(path.join(DIST, "404.html")).pipe(res);
}).listen(PORT, () => console.log(`HNet Media → http://localhost:${PORT}/`));
