(() => {
  const PRIMARY_WS = "wss://chatapp-heui.onrender.com";
  const FALLBACK_WS = "wss://ws.postman-echo.com/raw"; 
  let wsUrl = PRIMARY_WS;
  let ws; 
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  const MAX_RECONNECT_DELAY = 30_000; 

  const sendQueue = [];

  const roomListEl = document.getElementById("room-list");
  const roomSelectEl = document.getElementById("room-select");
  const createForm = document.getElementById("create-room-form");
  const roomNameInput = document.getElementById("room-name");
  const usernameInput = document.getElementById("username-input");
  const joinBtn = document.getElementById("join-btn");
  const leaveBtn = document.getElementById("leave-btn");
  const userListEl = document.getElementById("user-list");
  const currentRoomEl = document.getElementById("current-room");
  const messagesEl = document.getElementById("messages");
  const messageForm = document.getElementById("message-form");
  const messageInput = document.getElementById("message-input");
  const notificationsEl = document.getElementById("notifications");

  let state = { connected: false, username: null, room: null, rooms: [] };

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (m) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m];
    });
  }

  function formatText(s) {
    let t = escapeHtml(s);
    t = t.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
    return t;
  }

  function isoToTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString();
  }

  function addMessage({ username, text, time }, me) {
    const msg = document.createElement("div");
    msg.className = "message" + (me ? " me" : "");
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${username} • ${isoToTime(time)}`;
    const body = document.createElement("div");
    body.className = "body";
    body.innerHTML = formatText(text);
    msg.appendChild(meta);
    msg.appendChild(body);
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addSystem(text) {
    const el = document.createElement("div");
    el.className = "message";
    el.style.background = "#f3f4f6";
    el.style.textAlign = "center";
    el.style.fontSize = "13px";
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setRooms(rooms) {
    state.rooms = rooms;
    roomListEl.innerHTML = "";
    roomSelectEl.innerHTML = "";
    rooms.forEach(r => {
      const li = document.createElement("li");
      li.textContent = `${r.name} (${r.users})`;
      li.onclick = () => { roomSelectEl.value = r.name; };
      roomListEl.appendChild(li);
      const opt = document.createElement("option");
      opt.value = r.name;
      opt.textContent = r.name;
      roomSelectEl.appendChild(opt);
    });
  }

  function setUsers(users) {
    userListEl.innerHTML = "";
    users.forEach(u => {
      const li = document.createElement("li");
      li.textContent = u;
      userListEl.appendChild(li);
    });
  }

  function showNotification(msg) {
    if (!notificationsEl) return;
    notificationsEl.textContent = msg;
    notificationsEl.style.opacity = "1";
    setTimeout(() => notificationsEl.style.opacity = "0.6", 3000);
    if (document.hidden) {
      document.title = "New message — " + (state.room || "");
      setTimeout(() => document.title = "Unified Chat", 2000);
    }
  }

  function safeSend(obj) {
    const text = JSON.stringify(obj);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(text);
      } catch (e) {
        console.warn("Failed to send immediately, queuing:", e);
        sendQueue.push(text);
      }
    } else {
      sendQueue.push(text);
    }
  }

  function flushQueue() {
    while (sendQueue.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
      const txt = sendQueue.shift();
      try { ws.send(txt); } catch (e) { console.warn("flush send failed, requeue", e); sendQueue.unshift(txt); break; }
    }
  }

  function scheduleReconnect() {
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY);
    console.warn(`WebSocket disconnected. Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempts})`);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (reconnectAttempts > 5 && wsUrl !== FALLBACK_WS) {
        console.warn("Switching to fallback test WebSocket for local testing.");
        wsUrl = FALLBACK_WS;
      }
      connect();
    }, delay);
  }

  function resetReconnect() {
    reconnectAttempts = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }

  function connect() {
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      console.error("WebSocket construction failed:", e);
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      console.info("WebSocket open:", wsUrl);
      state.connected = true;
      resetReconnect();
      safeSend({ type: "list_rooms" });
      flushQueue();
    });

    ws.addEventListener("message", (ev) => {
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch (e) {
        console.warn("Received non-JSON message (ignored):", ev.data);
        return;
      }
      handleServerMessage(data);
    });

    ws.addEventListener("error", (err) => {
      console.error("WebSocket error:", err);
    });

    ws.addEventListener("close", (ev) => {
      console.warn("WebSocket closed:", ev.code, ev.reason);
      state.connected = false;
      addSystem("Disconnected from server.");
      joinBtn.classList.remove("hidden");
      leaveBtn.classList.add("hidden");
      messageForm.classList.add("hidden");
      scheduleReconnect();
    });
  }

  function handleServerMessage(data) {
    switch (data.type) {
      case "rooms":
        setRooms(data.rooms || []);
        break;
      case "created_room":
        safeSend({ type: "list_rooms" });
        break;
      case "join_failed":
        alert(data.message || "Failed to join");
        break;
      case "join_success":
        state.username = data.username;
        state.room = data.room;
        currentRoomEl.textContent = `# ${state.room}`;
        setUsers(data.users || []);
        joinBtn.classList.add("hidden");
        leaveBtn.classList.remove("hidden");
        messageForm.classList.remove("hidden");
        messagesEl.innerHTML = "";
        addSystem(`You joined ${state.room} as ${state.username}`);
        break;
      case "user_joined":
        setUsers(data.users || []);
        addSystem(`${data.username} joined the room.`);
        break;
      case "user_left":
        setUsers(data.users || []);
        addSystem(`${data.username} left the room.`);
        break;
      case "message":
        addMessage({ username: data.username, text: data.text, time: data.time }, data.username === state.username);
        showNotification(`Message from ${data.username}`);
        break;
      case "error":
        console.warn("Error from server:", data.message);
        break;
      default:
        console.warn("Unknown message type:", data.type);
    }
  }

  connect();

  createForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = roomNameInput.value.trim();
    if (!name) return;
    safeSend({ type: "create_room", room: name });
    roomNameInput.value = "";
  });

  joinBtn.addEventListener("click", () => {
    const username = usernameInput.value.trim();
    const room = roomSelectEl.value;
    if (!username) { alert("Please enter a username."); return; }
    if (!room) { alert("Please select a room."); return; }
    safeSend({ type: "join", room, username });
  });

  leaveBtn.addEventListener("click", () => {
    if (!state.room || !state.username) return;
    safeSend({ type: "leave", room: state.room, username: state.username });
    state.room = null;
    state.username = null;
    currentRoomEl.textContent = "Not in a room";
    userListEl.innerHTML = "";
    messagesEl.innerHTML = "";
    joinBtn.classList.remove("hidden");
    leaveBtn.classList.add("hidden");
    messageForm.classList.add("hidden");
  });

  messageForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = messageInput.value;
    if (!text || !text.trim()) return;
    safeSend({ type: "message", text });
    messageInput.value = "";
  });

  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      safeSend({ type: "list_rooms" });
    }
  }, 5000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      document.title = "Unified Chat";
    }
  });

  window._chatDebug = {
    getState: () => ({ wsUrl, readyState: ws ? ws.readyState : null, reconnectAttempts, queueLength: sendQueue.length }),
    reconnectNow: () => { if (ws) ws.close(); else connect(); }
  };

})();
