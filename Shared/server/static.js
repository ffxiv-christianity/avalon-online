"use strict";

const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

function serveSharedStatic(req, res, requestUrl) {
  if (!requestUrl.pathname.startsWith("/shared/")) return false;
  const relativePath = requestUrl.pathname.replace(/^\/shared\/?/, "");
  const safePath = path.normalize(relativePath).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const publicRoot = path.resolve(PUBLIC_DIR);
  const filePath = path.resolve(PUBLIC_DIR, safePath);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    res.end(data);
  });
  return true;
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

module.exports = { serveSharedStatic };
