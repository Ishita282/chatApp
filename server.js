// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files from public
app.use(express.static(path.join(__dirname, "public")));

/*
 Data structures:
 rooms: Map roomName -> {
   users: Map username -> ws,
   createdAt: Date
 }
*/
const rooms = new Map();

// send JSON helper
function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (e) {}
}

// broadcast to all users in a room
function broadcast(roomName, obj) {
  const room = rooms.get(roomName);
  if (!room) return;
  for (const [uname, clientWs] of room.users) {
    if (clientWs.readyState === WebSocket.OPEN) {
      send(clientWs, obj);
    }
  }
}

// get public room list
function getRoomList() {
  const list = [];
  for (const [name, room] of rooms) {
    list.push({ name, users: room.users.size, createdAt: room.createdAt });
  }
  return list;
}

wss.on("connection", (ws) => {
  // track current user info on ws
  ws._meta = { username: null, room: null };

  // Setup simple ping/pong to keep alive
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch (e) { return; }

    const type = data.type;

    if (type === "list_rooms") {
      send(ws, { type: "rooms", rooms: getRoomList() });
      return;
    }

    if (type === "create_room") {
      const { room } = data;
      if (!room || typeof room !== "string") {
        send(ws, { type: "error", message: "Invalid room name." });
        return;
      }
      if (!rooms.has(room)) {
        rooms.set(room, { users: new Map(), createdAt: new Date().toISOString() });
      }
      send(ws, { type: "created_room", room });
      // broadcast updated rooms to all connected
      for (const client of wss.clients) {
        send(client, { type: "rooms", rooms: getRoomList() });
      }
      return;
    }

    if (type === "join") {
      const { room, username } = data;
      if (!room || !username) {
        send(ws, { type: "error", message: "Missing room or username." });
        return;
      }
      let roomObj = rooms.get(room);
      if (!roomObj) {
        // create room if not exists
        roomObj = { users: new Map(), createdAt: new Date().toISOString() };
        rooms.set(room, roomObj);
      }
      if (roomObj.users.has(username)) {
        send(ws, { type: "join_failed", message: "Username already in use in this room." });
        return;
      }

      // store user
      ws._meta.username = username;
      ws._meta.room = room;
      roomObj.users.set(username, ws);

      // reply success and current user list
      send(ws, { type: "join_success", room, username, users: Array.from(roomObj.users.keys()) });

      // notify others in room
      broadcast(room, {
        type: "user_joined",
        username,
        users: Array.from(roomObj.users.keys()),
        time: new Date().toISOString()
      });

      // refresh rooms list to all
      for (const client of wss.clients) {
        send(client, { type: "rooms", rooms: getRoomList() });
      }
      return;
    }

    if (type === "leave") {
      const { room, username } = data;
      const roomObj = rooms.get(room);
      if (roomObj && roomObj.users.has(username)) {
        roomObj.users.delete(username);
        broadcast(room, { type: "user_left", username, users: Array.from(roomObj.users.keys()), time: new Date().toISOString() });
        if (roomObj.users.size === 0) rooms.delete(room);
        for (const client of wss.clients) {
          send(client, { type: "rooms", rooms: getRoomList() });
        }
      }
      ws._meta = { username: null, room: null };
      return;
    }

    if (type === "message") {
      const { text } = data;
      const username = ws._meta.username;
      const room = ws._meta.room;
      if (!username || !room) {
        send(ws, { type: "error", message: "You are not in a room." });
        return;
      }
      if (typeof text !== "string" || text.trim().length === 0) {
        send(ws, { type: "error", message: "Empty message." });
        return;
      }
      const msgObj = { type: "message", username, text, time: new Date().toISOString() };
      broadcast(room, msgObj);
      return;
    }

    // unknown type -> ignore
  });

  ws.on("close", () => {
    const meta = ws._meta || {};
    const { username, room } = meta;
    if (username && room) {
      const roomObj = rooms.get(room);
      if (roomObj && roomObj.users.has(username)) {
        roomObj.users.delete(username);
        broadcast(room, { type: "user_left", username, users: Array.from(roomObj.users.keys()), time: new Date().toISOString() });
        if (roomObj.users.size === 0) rooms.delete(room);
        for (const client of wss.clients) {
          send(client, { type: "rooms", rooms: getRoomList() });
        }
      }
    }
  });
});

// heartbeat to drop dead clients
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
