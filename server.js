// Litster Online: winziger Relais-Server. Die Litster-App (Host) schickt den Spielstand,
// Fernseher und Mitspieler-Handys (Clients) bekommen ihn und schicken Aktionen zurück.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const page = () => fs.readFileSync(path.join(__dirname, "index.html"));

const server = http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200); return res.end("ok"); }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(page());
});

const rooms = new Map(); // code -> { host, clients:Set, state, updated }
function room(code) {
  if (!rooms.has(code)) rooms.set(code, { host: null, clients: new Set(), state: null, updated: Date.now() });
  return rooms.get(code);
}
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  ws.room = null; ws.role = null; ws.alive = true;
  ws.on("pong", () => { ws.alive = true; });
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === "join" && typeof m.room === "string") {
      const code = m.room.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (code.length < 4) return send(ws, { type: "error", msg: "Ungültiger Code" });
      const r = room(code); ws.room = code; ws.role = m.role === "host" ? "host" : "client";
      if (ws.role === "host") { r.host = ws; send(ws, { type: "joined", room: code, clients: r.clients.size }); }
      else { r.clients.add(ws); send(ws, { type: "joined", room: code, hasHost: !!r.host }); if (r.state) send(ws, { type: "state", state: r.state }); send(r.host, { type: "clients", n: r.clients.size }); }
      return;
    }
    const r = ws.room && rooms.get(ws.room); if (!r) return;
    if (m.type === "state" && ws.role === "host") { r.state = m.state; r.updated = Date.now(); for (const c of r.clients) send(c, { type: "state", state: m.state }); }
    else if (m.type === "action" && ws.role === "client") { send(r.host, { type: "action", action: m.action, player: m.player }); }
  });
  ws.on("close", () => {
    const r = ws.room && rooms.get(ws.room); if (!r) return;
    if (ws.role === "host" && r.host === ws) { r.host = null; for (const c of r.clients) send(c, { type: "hostgone" }); }
    else { r.clients.delete(ws); send(r.host, { type: "clients", n: r.clients.size }); }
  });
});
// Verbindungen am Leben halten und alte Räume aufräumen
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }
  for (const [code, r] of rooms) if (!r.host && r.clients.size === 0 && Date.now() - r.updated > 6 * 3600e3) rooms.delete(code);
}, 30000);

server.listen(PORT, () => console.log("Litster Online läuft auf Port " + PORT));
