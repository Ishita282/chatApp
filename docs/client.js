// client.js
(() => {
  const ws = new WebSocket("wss:https://chatapp-heui.onrender.com ");

  // DOM
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

  // small utilities
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (m) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m];
    });
  }

  // basic formatting: **bold**, *italic*, and links (http(s)://)
  function formatText(s) {
    // escape first
    let t = escapeHtml(s);
    // links
    t = t.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    // bold **text**
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // italic *text*
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
    // auto scroll
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setRooms(rooms) {
    state.rooms = rooms;
    // room list
    roomListEl.innerHTML = "";
    roomSelectEl.innerHTML = "";
    rooms.forEach(r => {
      const li = document.createElement("li");
      li.textContent = `${r.name} (${r.users})`;
      li.onclick = () => {
        roomSelectEl.value = r.name;
      };
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
    notificationsEl.textContent = msg;
    notificationsEl.style.opacity = "1";
    setTimeout(() => notificationsEl.style.opacity = "0.6", 3000);
    // small title notification
    if (document.hidden) {
      document.title = "New message — " + (state.room || "");
      setTimeout(() => document.title = "Unified Chat", 2000);
    }
  }

  // WebSocket events
  ws.addEventListener("open", () => {
    state.connected = true;
    ws.send(JSON.stringify({ type: "list_rooms" }));
  });

  ws.addEventListener("message", (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch (e) { return; }
    switch (data.type) {
      case "rooms":
        setRooms(data.rooms || []);
        break;
      case "created_room":
        // refresh
        ws.send(JSON.stringify({ type: "list_rooms" }));
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
        // ignore
    }
  });

  ws.addEventListener("close", () => {
    state.connected = false;
    addSystem("Disconnected from server.");
    joinBtn.classList.remove("hidden");
    leaveBtn.classList.add("hidden");
    messageForm.classList.add("hidden");
  });

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

  // paging: create room
  createForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = roomNameInput.value.trim();
    if (!name) return;
    ws.send(JSON.stringify({ type: "create_room", room: name }));
    roomNameInput.value = "";
  });

  // join
  joinBtn.addEventListener("click", () => {
    const username = usernameInput.value.trim();
    const room = roomSelectEl.value;
    if (!username) { alert("Please enter a username."); return; }
    if (!room) { alert("Please select a room."); return; }
    ws.send(JSON.stringify({ type: "join", room, username }));
  });

  leaveBtn.addEventListener("click", () => {
    if (!state.room || !state.username) return;
    ws.send(JSON.stringify({ type: "leave", room: state.room, username: state.username }));
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
    ws.send(JSON.stringify({ type: "message", text }));
    messageInput.value = "";
  });

  // initial list fetch every 5s to keep in sync
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "list_rooms" }));
  }, 5000);

  // register visibility change to clear notifications
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      document.title = "Unified Chat";
    }
  });

})();
