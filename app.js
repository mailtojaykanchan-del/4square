const SQUARES = [
  { label: "Square 1", short: "1", role: "Line", x: 0, y: 1 },
  { label: "Square 2", short: "2", role: "Build", x: 1, y: 1 },
  { label: "Square 3", short: "3", role: "Attack", x: 0, y: 0 },
  { label: "King", short: "4", role: "Serve", x: 1, y: 0 },
];

const courtColors = ["#f1c85c", "#62b7c4", "#e8806f", "#77be73"];
const courtPalettes = [
  { base: "#f3c64e", light: "#ffe184", dark: "#c78c22", line: "#fff1b2" },
  { base: "#50b6c7", light: "#8bdbe6", dark: "#277f94", line: "#c8f5fb" },
  { base: "#df725f", light: "#ffa08e", dark: "#a94335", line: "#ffd4ca" },
  { base: "#72bd70", light: "#a7e68e", dark: "#3e8548", line: "#d8f8c8" },
];
const storageKey = "foursquare-live-session";
const nameKey = "foursquare-live-name";
const colorKey = "foursquare-live-color";

const elements = {
  canvas: document.querySelector("#courtCanvas"),
  courtStatus: document.querySelector("#courtStatus"),
  playerName: document.querySelector("#playerName"),
  playerColor: document.querySelector("#playerColor"),
  roomCodeInput: document.querySelector("#roomCodeInput"),
  createRoomButton: document.querySelector("#createRoomButton"),
  joinRoomButton: document.querySelector("#joinRoomButton"),
  joinPanel: document.querySelector("#joinPanel"),
  gamePanel: document.querySelector("#gamePanel"),
  roomStrip: document.querySelector("#roomStrip"),
  copyRoomButton: document.querySelector("#copyRoomButton"),
  connectionDot: document.querySelector("#connectionDot"),
  yourSquare: document.querySelector("#yourSquare"),
  seatGrid: document.querySelector("#seatGrid"),
  readyButton: document.querySelector("#readyButton"),
  startButton: document.querySelector("#startButton"),
  botsButton: document.querySelector("#botsButton"),
  leaveSeatButton: document.querySelector("#leaveSeatButton"),
  leaveRoomButton: document.querySelector("#leaveRoomButton"),
  difficultyButtons: document.querySelectorAll(".difficulty-button"),
  hitPanel: document.querySelector("#hitPanel"),
  targetGrid: document.querySelector("#targetGrid"),
  hitButton: document.querySelector("#hitButton"),
  faultButton: document.querySelector("#faultButton"),
  playersList: document.querySelector("#playersList"),
  playerCount: document.querySelector("#playerCount"),
  roundCount: document.querySelector("#roundCount"),
  feed: document.querySelector("#feed"),
};

const ctx = elements.canvas.getContext("2d");
const deviceScale = () => Math.max(1, Math.min(2, window.devicePixelRatio || 1));
const memoryStorage = new Map();
const storage = {
  getItem(key) {
    try {
      return window.localStorage?.getItem(key) ?? memoryStorage.get(key) ?? null;
    } catch {
      return memoryStorage.get(key) ?? null;
    }
  },
  setItem(key, value) {
    memoryStorage.set(key, value);
    try {
      window.localStorage?.setItem(key, value);
    } catch {
      // Some embedded browsers disable persistent storage.
    }
  },
  removeItem(key) {
    memoryStorage.delete(key);
    try {
      window.localStorage?.removeItem(key);
    } catch {
      // Some embedded browsers disable persistent storage.
    }
  },
};
let session = loadSession();
let room = null;
let selectedStyle = "drive";
let selectedTargetSeat = null;
let lastErrorAt = 0;
let pollTimer = null;
let animationFrame = null;
let lastSnapshotAt = 0;
let connectionInfo = null;
let localSeat = -1;
let localPosition = { x: 0.5, y: 0.5 };
let lastFrameAt = performance.now();
let lastMoveSentAt = 0;
let lastStrikeAt = 0;
const pressedKeys = new Set();
const HIT_RADIUS = 0.22;
const MOVE_SPEED = 0.78;
let spaceHeld = false;
let eHeld = false;
let spaceAimed = false;
let chargeTriggered = false;

function loadSession() {
  try {
    return JSON.parse(storage.getItem(storageKey)) || {};
  } catch {
    return {};
  }
}

function saveSession(nextSession) {
  session = { ...session, ...nextSession };
  storage.setItem(storageKey, JSON.stringify(session));
}

function playerName() {
  const value = elements.playerName.value.trim() || "Player";
  storage.setItem(nameKey, value);
  return value;
}

function playerColor() {
  const value = elements.playerColor.value || "#287c91";
  storage.setItem(colorKey, value);
  return value;
}

function playerById(id) {
  return room?.players.find((player) => player.id === id);
}

function myPlayer() {
  return playerById(session.playerId);
}

function mySeat() {
  return room?.seats.indexOf(session.playerId) ?? -1;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

async function fetchConnectionInfo() {
  try {
    connectionInfo = await api("/api/connection");
  } catch {
    connectionInfo = {
      origin: location.origin,
      networkOrigins: [],
      preferredOrigin: location.origin,
    };
  }
}

function shareOrigin() {
  return connectionInfo?.preferredOrigin || location.origin;
}

function shareUrl() {
  return `${shareOrigin()}/#${session.code}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    const input = document.createElement("input");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}

async function createRoom() {
  const data = await api("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      name: playerName(),
      color: playerColor(),
    }),
  });
  saveSession({ playerId: data.playerId, code: data.room.code });
  setRoom(data.room);
  history.replaceState(null, "", `#${data.room.code}`);
  showToast("Room created.");
  startPolling();
}

async function joinRoom(code = elements.roomCodeInput.value) {
  const cleanCode = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  if (cleanCode.length !== 4) {
    showToast("Enter a four-character room code.");
    return;
  }

  const data = await api(`/api/rooms/${cleanCode}/join`, {
    method: "POST",
    body: JSON.stringify({
      playerId: session.playerId,
      name: playerName(),
      color: playerColor(),
    }),
  });
  saveSession({ playerId: data.playerId, code: data.room.code });
  setRoom(data.room);
  history.replaceState(null, "", `#${data.room.code}`);
  showToast("Joined room.");
  startPolling();
}

async function sendAction(action) {
  if (!session.code || !session.playerId) return;

  try {
    const data = await api(`/api/rooms/${session.code}/action`, {
      method: "POST",
      body: JSON.stringify({
        playerId: session.playerId,
        ...action,
      }),
    });
    setRoom(data);
  } catch (error) {
    showToast(error.message);
  }
}

async function leaveRoom() {
  if (session.code && session.playerId) {
    try {
      await api(`/api/rooms/${session.code}/action`, {
        method: "POST",
        body: JSON.stringify({
          playerId: session.playerId,
          type: "leaveRoom",
        }),
      });
    } catch (error) {
      showToast(error.message);
    }
  }
  clearInterval(pollTimer);
  room = null;
  localSeat = -1;
  localPosition = { x: 0.5, y: 0.5 };
  selectedTargetSeat = null;
  session = {};
  storage.removeItem(storageKey);
  elements.roomCodeInput.value = "";
  elements.connectionDot.className = "connection-dot";
  elements.connectionDot.title = "";
  history.replaceState(null, "", location.pathname + location.search);
  render();
  showToast("Left room.");
}

function postMove(force = false) {
  if (!session.code || !session.playerId || mySeat() < 0) return;

  const currentTime = Date.now();
  if (!force && currentTime - lastMoveSentAt < 140) return;
  lastMoveSentAt = currentTime;

  fetch(`/api/rooms/${session.code}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      playerId: session.playerId,
      type: "move",
      position: localPosition,
    }),
  }).catch(() => {});
}

async function pollRoom() {
  if (!session.code || !session.playerId) return;

  try {
    const data = await api(`/api/rooms/${session.code}?playerId=${encodeURIComponent(session.playerId)}`);
    setRoom(data);
    elements.connectionDot.className = "connection-dot online";
    elements.connectionDot.title = "Connected";
    lastSnapshotAt = Date.now();
  } catch (error) {
    elements.connectionDot.className = "connection-dot warn";
    elements.connectionDot.title = "Connection lost";
    if (Date.now() - lastErrorAt > 5000) {
      showToast(error.message);
      lastErrorAt = Date.now();
    }
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollRoom();
  pollTimer = setInterval(pollRoom, 850);
}

function setRoom(nextRoom) {
  const nextSeat = nextRoom?.seats.indexOf(session.playerId) ?? -1;
  const incomingPlayer = nextRoom?.players.find((player) => player.id === session.playerId);
  if (nextSeat !== localSeat || localSeat === -1) {
    localPosition = cleanPosition(incomingPlayer?.position);
  }
  localSeat = nextSeat;
  room = nextRoom;
  render();
}

function render() {
  const hasRoom = Boolean(room && session.playerId);
  elements.joinPanel.hidden = hasRoom;
  elements.gamePanel.hidden = !hasRoom;
  elements.roomStrip.hidden = !hasRoom;

  if (!hasRoom) {
    elements.playerCount.textContent = "0";
    elements.roundCount.textContent = "Lobby";
    elements.playersList.innerHTML = "";
    elements.feed.innerHTML = "";
    renderEmptyCourt();
    return;
  }

  elements.copyRoomButton.textContent = room.code;
  elements.copyRoomButton.title = `Copy room link: ${shareUrl()}`;
  elements.roomCodeInput.value = room.code;

  const me = myPlayer();
  const seat = mySeat();
  elements.yourSquare.textContent = seat >= 0 ? SQUARES[seat].label : "Line";
  elements.readyButton.textContent = me?.ready ? "Unready" : "Ready";
  elements.readyButton.disabled = seat < 0;
  elements.startButton.disabled = !room.canStart;
  elements.botsButton.disabled = !room.canControl;
  elements.leaveSeatButton.disabled = seat < 0;
  elements.leaveRoomButton.disabled = false;
  elements.difficultyButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.difficulty === (room.botDifficulty || "medium"));
    button.disabled = !room.canControl;
  });

  renderSeats();
  renderTargets();
  renderPlayers();
  renderFeed();
  renderStatus();
}

function renderSeats() {
  elements.seatGrid.innerHTML = "";
  SQUARES.forEach((square, index) => {
    const player = playerById(room.seats[index]);
    const button = document.createElement("button");
    button.className = ["seat-button", player ? "occupied" : "", room.seats[index] === session.playerId ? "mine" : ""]
      .filter(Boolean)
      .join(" ");
    button.type = "button";
    button.disabled = Boolean(player && player.id !== session.playerId);
    button.innerHTML = `
      <span>
        <strong>${escapeHtml(square.label)}</strong>
        <small>${player ? escapeHtml(player.name) : "Open"}</small>
      </span>
      <small>${escapeHtml(square.role)}</small>
    `;
    button.addEventListener("click", () => sendAction({ type: "seat", seat: index }));
    elements.seatGrid.append(button);
  });
}

function renderTargets() {
  const me = myPlayer();
  const isMyTouch = room.state === "playing" && room.rally?.turnPlayerId === session.playerId;
  elements.hitPanel.hidden = !isMyTouch;
  elements.targetGrid.innerHTML = "";

  if (isMyTouch && !isValidTargetSeat(selectedTargetSeat)) {
    selectedTargetSeat = defaultTargetSeat();
  }
  elements.hitButton.disabled = !isMyTouch || !isValidTargetSeat(selectedTargetSeat) || !isNearBall();

  SQUARES.forEach((square, index) => {
    const player = playerById(room.seats[index]);
    const button = document.createElement("button");
    button.className = ["target-button", selectedTargetSeat === index ? "selected" : ""].filter(Boolean).join(" ");
    button.type = "button";
    button.disabled = !isMyTouch || !player || player.id === me?.id;
    button.innerHTML = `
      <strong>${escapeHtml(square.label)}</strong>
      <small>${player ? escapeHtml(player.name) : "Empty"}</small>
    `;
    button.addEventListener("click", () => {
      if (spaceHeld) {
        spaceAimed = true;
        attemptStrike({ targetSeat: index, charged: eHeld });
      } else {
        selectedTargetSeat = index;
        renderTargets();
      }
    });
    elements.targetGrid.append(button);
  });
}

function isValidTargetSeat(seat) {
  if (seat < 0 || seat > 3 || !room) return false;
  const player = playerById(room.seats[seat]);
  return Boolean(player && player.id !== session.playerId);
}

function defaultTargetSeat() {
  const fromSeat = room?.rally?.fromSeat;
  if (isValidTargetSeat(fromSeat)) return fromSeat;
  return SQUARES.findIndex((_, index) => isValidTargetSeat(index));
}

function randomTargetSeat() {
  const targets = SQUARES
    .map((_, index) => index)
    .filter((seat) => isValidTargetSeat(seat));
  return targets[Math.floor(Math.random() * targets.length)];
}

function isMyTouch() {
  return room?.state === "playing" && room.rally?.turnPlayerId === session.playerId;
}

function isNearBall() {
  const seat = mySeat();
  const landing = room?.rally?.landing;
  if (!isMyTouch() || seat < 0 || landing?.seat !== seat) return false;

  const dx = localPosition.x - landing.x;
  const dy = localPosition.y - landing.y;
  return Math.hypot(dx, dy) <= HIT_RADIUS;
}

function attemptStrike(options = {}) {
  const currentTime = Date.now();
  if (currentTime - lastStrikeAt < 420) return;
  lastStrikeAt = currentTime;

  if (!isMyTouch()) {
    showToast("It is not your touch.");
    return;
  }

  if (!isNearBall()) {
    showToast("Get closer to the ball.");
    return;
  }

  const targetSeat = options.random
    ? randomTargetSeat()
    : options.targetSeat ?? selectedTargetSeat ?? defaultTargetSeat();

  if (!isValidTargetSeat(targetSeat)) {
    showToast("Pick a target.");
    return;
  }

  selectedTargetSeat = targetSeat;
  postMove(true);
  sendAction({
    type: "hit",
    targetSeat,
    style: options.charged ? "charge" : selectedStyle,
  });
}

function renderPlayers() {
  elements.playerCount.textContent = String(room.players.length);
  elements.playersList.innerHTML = "";

  if (!room.players.length) {
    elements.playersList.innerHTML = `<div class="feed-item">No players yet.</div>`;
    return;
  }

  room.players.forEach((player) => {
    const seat = room.seats.indexOf(player.id);
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `
      <span class="avatar" style="background:${escapeAttr(player.color)}"></span>
      <span>
        <span class="player-name">${escapeHtml(player.name)}${player.id === session.playerId ? " (you)" : ""}</span>
        <span class="player-meta">${seat >= 0 ? escapeHtml(SQUARES[seat].label) : "Line"} · ${player.stats.hits} hits · ${player.stats.outs} outs</span>
      </span>
      <span class="player-badge ${player.online ? "live" : ""}">${player.isBot ? "Bot" : player.online ? "Live" : "Away"}</span>
    `;
    elements.playersList.append(row);
  });
}

function renderFeed() {
  elements.roundCount.textContent = room.state === "playing" ? `Round ${room.round}` : "Lobby";
  elements.feed.innerHTML = "";

  if (!room.feed.length) {
    elements.feed.innerHTML = `<div class="feed-item">Waiting for the first serve.</div>`;
    return;
  }

  room.feed.slice(0, 14).forEach((item) => {
    const entry = document.createElement("div");
    entry.className = "feed-item";
    entry.textContent = item.text;
    elements.feed.append(entry);
  });
}

function renderStatus() {
  if (!room) {
    renderEmptyCourt();
    return;
  }

  const turnPlayer = playerById(room.rally?.turnPlayerId);
  const remaining = room.rally ? Math.max(0, Math.ceil((room.rally.deadline - room.serverTime) / 1000)) : 0;
  const left = room.state === "playing" && turnPlayer
    ? `${turnPlayer.name}'s touch`
    : "Lobby";
  const right = room.state === "playing" && room.rally?.turnPlayerId === session.playerId
    ? `${isNearBall() ? "Ready" : "Reach ball"} · ${remaining}s`
    : room.state === "playing"
    ? `${remaining}s`
    : "Pick a square";

  elements.courtStatus.innerHTML = `
    <span class="status-pill">${escapeHtml(left)}</span>
    <span class="status-pill">${escapeHtml(right)}</span>
  `;
}

function renderEmptyCourt() {
  elements.courtStatus.innerHTML = `
    <span class="status-pill">Create or join a room</span>
    <span class="status-pill">Four squares, one serve</span>
  `;
}

function drawCourt() {
  const currentFrameAt = performance.now();
  const deltaSeconds = Math.min(0.05, (currentFrameAt - lastFrameAt) / 1000);
  lastFrameAt = currentFrameAt;
  updateLocalMovement(deltaSeconds);

  resizeCanvas();
  const { width, height } = elements.canvas.getBoundingClientRect();
  const scale = deviceScale();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);

  drawCanvasBackdrop(width, height);

  const courtSize = Math.min(width - 62, height - 62);
  const left = (width - courtSize) / 2;
  const top = (height - courtSize) / 2;
  const half = courtSize / 2;

  ctx.save();
  ctx.translate(left, top);

  ctx.shadowColor = "rgba(18, 31, 36, 0.26)";
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = "#f7fbf4";
  roundedRect(ctx, -18, -18, courtSize + 36, courtSize + 36, 14);
  ctx.fill();
  ctx.shadowColor = "transparent";

  const apronGradient = ctx.createLinearGradient(0, -18, courtSize, courtSize + 18);
  apronGradient.addColorStop(0, "#ffffff");
  apronGradient.addColorStop(0.45, "#ecf5ef");
  apronGradient.addColorStop(1, "#d8e9e1");
  ctx.fillStyle = apronGradient;
  roundedRect(ctx, -10, -10, courtSize + 20, courtSize + 20, 12);
  ctx.fill();

  ctx.save();
  roundedRect(ctx, 0, 0, courtSize, courtSize, 8);
  ctx.clip();

  SQUARES.forEach((square, index) => {
    const x = square.x * half;
    const y = square.y * half;
    drawSquareSurface(square, index, x, y, half);
  });

  ctx.restore();

  drawCourtLines(courtSize, half);
  drawTurnGlow(half);
  drawAimPreview(half);
  ctx.beginPath();

  drawPlayers(left, top, courtSize, half);
  drawBall(courtSize, half);
  ctx.restore();

  animationFrame = requestAnimationFrame(drawCourt);
}

function drawCanvasBackdrop(width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f6f8f3");
  gradient.addColorStop(0.46, "#e3eee9");
  gradient.addColorStop(1, "#dce6e9");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#8aa09d";
  ctx.lineWidth = 1;
  for (let x = -height; x < width; x += 34) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + height, height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSquareSurface(square, index, x, y, half) {
  const palette = courtPalettes[index];
  const gradient = ctx.createLinearGradient(x, y, x + half, y + half);
  gradient.addColorStop(0, palette.light);
  gradient.addColorStop(0.42, palette.base);
  gradient.addColorStop(1, palette.dark);
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, half, half);

  ctx.save();
  ctx.globalAlpha = 0.24;
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 2;
  for (let stripe = -half; stripe < half * 1.8; stripe += 24) {
    ctx.beginPath();
    ctx.moveTo(x + stripe, y);
    ctx.lineTo(x + stripe + half * 0.55, y + half);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, half, half * 0.42);
  ctx.restore();

  ctx.fillStyle = "rgba(18, 31, 36, 0.7)";
  ctx.font = "800 18px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(square.label, x + 18, y + 31);

  ctx.font = "950 92px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.48)";
  ctx.fillText(square.short, x + 18, y + half - 20);
}

function drawCourtLines(courtSize, half) {
  ctx.save();
  ctx.strokeStyle = "rgba(23, 33, 38, 0.16)";
  ctx.lineWidth = 14;
  roundedRect(ctx, 0, 0, courtSize, courtSize, 8);
  ctx.stroke();

  ctx.strokeStyle = "#fffdf7";
  ctx.lineWidth = 8;
  roundedRect(ctx, 0, 0, courtSize, courtSize, 8);
  ctx.stroke();

  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(half, 5);
  ctx.lineTo(half, courtSize - 5);
  ctx.moveTo(5, half);
  ctx.lineTo(courtSize - 5, half);
  ctx.stroke();

  ctx.strokeStyle = "rgba(23, 33, 38, 0.12)";
  ctx.lineWidth = 2;
  roundedRect(ctx, 14, 14, courtSize - 28, courtSize - 28, 6);
  ctx.stroke();
  ctx.restore();
}

function drawTurnGlow(half) {
  const player = playerById(room?.rally?.turnPlayerId);
  const seat = player ? squareForPlayer(player.id) : -1;
  if (!player || seat < 0) return;

  const square = SQUARES[seat];
  const x = square.x * half;
  const y = square.y * half;
  ctx.save();
  ctx.globalAlpha = 0.18 + Math.sin(Date.now() / 220) * 0.04;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 10, y + 10, half - 20, half - 20);
  ctx.restore();
}

function drawAimPreview(half) {
  if (!isMyTouch() || !isValidTargetSeat(selectedTargetSeat)) return;

  const start = squarePoint(mySeat(), localPosition, half);
  const end = squarePoint(selectedTargetSeat, { x: 0.5, y: 0.5 }, half);
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 10]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo((start.x + end.x) / 2, Math.min(start.y, end.y) - half * 0.18, end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(23, 33, 38, 0.22)";
  ctx.beginPath();
  ctx.arc(end.x, end.y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function updateLocalMovement(deltaSeconds) {
  const seat = mySeat();
  if (!room || seat < 0) return;

  let dx = 0;
  let dy = 0;
  if (pressedKeys.has("arrowleft") || pressedKeys.has("a")) dx -= 1;
  if (pressedKeys.has("arrowright") || pressedKeys.has("d")) dx += 1;
  if (pressedKeys.has("arrowup") || pressedKeys.has("w")) dy -= 1;
  if (pressedKeys.has("arrowdown") || pressedKeys.has("s")) dy += 1;

  if (!dx && !dy) return;

  const length = Math.hypot(dx, dy) || 1;
  localPosition = cleanPosition({
    x: localPosition.x + (dx / length) * MOVE_SPEED * deltaSeconds,
    y: localPosition.y + (dy / length) * MOVE_SPEED * deltaSeconds,
  });
  postMove();
  renderStatus();
  renderTargets();
}

function moveToPointer(event) {
  const seat = mySeat();
  if (!room || seat < 0) return;

  const metrics = courtMetrics();
  if (spaceHeld) {
    const targetSeat = pointerSeat(event, metrics);
    if (isValidTargetSeat(targetSeat)) {
      spaceAimed = true;
      if (eHeld) chargeTriggered = true;
      attemptStrike({ targetSeat, charged: eHeld });
    } else {
      showToast("Aim at another player.");
    }
    event.preventDefault();
    return;
  }

  const square = SQUARES[seat];
  const pointerX = event.clientX - metrics.rect.left - metrics.left - square.x * metrics.half;
  const pointerY = event.clientY - metrics.rect.top - metrics.top - square.y * metrics.half;
  localPosition = cleanPosition({
    x: pointerX / metrics.half,
    y: pointerY / metrics.half,
  });
  postMove(true);
  renderStatus();
  renderTargets();
  event.preventDefault();
}

function pointerSeat(event, metrics = courtMetrics()) {
  const x = event.clientX - metrics.rect.left - metrics.left;
  const y = event.clientY - metrics.rect.top - metrics.top;
  if (x < 0 || y < 0 || x > metrics.courtSize || y > metrics.courtSize) return -1;
  const col = x >= metrics.half ? 1 : 0;
  const row = y >= metrics.half ? 1 : 0;
  return SQUARES.findIndex((square) => square.x === col && square.y === row);
}

function courtMetrics() {
  const rect = elements.canvas.getBoundingClientRect();
  const courtSize = Math.min(rect.width - 42, rect.height - 42);
  const left = (rect.width - courtSize) / 2;
  const top = (rect.height - courtSize) / 2;
  return {
    rect,
    courtSize,
    half: courtSize / 2,
    left,
    top,
  };
}

function drawPlayers(_left, _top, courtSize, half) {
  if (!room) return;

  room.seats.forEach((playerId, seat) => {
    const player = playerById(playerId);
    if (!player) return;

    const center = playerPoint(player, seat, half);
    const pulse = room.rally?.turnPlayerId === player.id ? 1 + Math.sin(Date.now() / 180) * 0.04 : 1;
    const isCurrent = room.rally?.turnPlayerId === player.id;
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.scale(pulse, pulse);

    ctx.fillStyle = "rgba(18, 31, 36, 0.2)";
    ctx.beginPath();
    ctx.ellipse(3, 42, 34, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    if (isCurrent) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 5, 43, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(23, 33, 38, 0.34)";
    ctx.fillRect(-20, 24, 12, 20);
    ctx.fillRect(8, 24, 12, 20);

    const bodyGradient = ctx.createLinearGradient(-28, -16, 28, 34);
    bodyGradient.addColorStop(0, mixColor(player.color, "#ffffff", 0.38));
    bodyGradient.addColorStop(0.48, player.color);
    bodyGradient.addColorStop(1, mixColor(player.color, "#000000", 0.28));
    ctx.fillStyle = bodyGradient;
    roundedRect(ctx, -28, -18, 56, 54, 18);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    roundedRect(ctx, -20, -12, 24, 42, 12);
    ctx.fill();

    const headGradient = ctx.createRadialGradient(-7, -31, 4, 0, -26, 22);
    headGradient.addColorStop(0, "#fff4d8");
    headGradient.addColorStop(1, "#d99766");
    ctx.fillStyle = headGradient;
    ctx.beginPath();
    ctx.arc(0, -29, 19, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.86)";
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "950 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(player.name), 0, 8);

    ctx.fillStyle = "rgba(23, 33, 38, 0.58)";
    ctx.fillRect(-26, 44, 19, 6);
    ctx.fillRect(7, 44, 19, 6);
    ctx.restore();

    ctx.save();
    const labelWidth = Math.min(120, Math.max(48, player.name.length * 8 + 20));
    ctx.fillStyle = "rgba(255, 255, 255, 0.76)";
    roundedRect(ctx, center.x - labelWidth / 2, Math.min(courtSize - 28, center.y + 54), labelWidth, 24, 8);
    ctx.fill();
    ctx.fillStyle = "rgba(23, 33, 38, 0.84)";
    ctx.font = "800 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(player.name, center.x, Math.min(courtSize - 16, center.y + 66));
    ctx.restore();
  });
}

function drawBall(courtSize, half) {
  const time = Date.now();
  let center = squarePoint(3, { x: 0.5, y: 0.5 }, half);
  let trailFrom = null;
  let trailTo = null;
  let trailEase = 1;
  let shotStyle = "serve";

  if (room?.rally) {
    const { lastMove } = room.rally;
    const from = squarePoint(lastMove.fromSeat ?? room.rally.ballSeat, lastMove.fromPosition || { x: 0.5, y: 0.5 }, half);
    const to = squarePoint(lastMove.targetSeat ?? room.rally.ballSeat, lastMove.landing || room.rally.landing || { x: 0.5, y: 0.5 }, half);
    const elapsed = Math.min(1, (time - (lastMove.at || time)) / 760);
    const ease = 1 - Math.pow(1 - elapsed, 3);
    trailFrom = from;
    trailTo = to;
    trailEase = ease;
    shotStyle = lastMove.style || "drive";
    center = {
      x: from.x + (to.x - from.x) * ease,
      y: from.y + (to.y - from.y) * ease - Math.sin(ease * Math.PI) * 42,
    };
  }

  const bounce = Math.sin(time / 130) * 2;
  if (trailFrom && trailTo) {
    drawBallTrail(trailFrom, trailTo, trailEase, shotStyle, half);
  }

  ctx.save();
  ctx.translate(center.x, center.y + bounce);
  ctx.fillStyle = "rgba(23, 33, 38, 0.2)";
  ctx.beginPath();
  ctx.ellipse(8, 31, 21, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  const ballGradient = ctx.createRadialGradient(-7, -8, 3, 0, 0, 18);
  ballGradient.addColorStop(0, "#ffd6a9");
  ballGradient.addColorStop(0.48, "#f26f3f");
  ballGradient.addColorStop(1, "#b94028");
  ctx.fillStyle = ballGradient;
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 12, Math.PI * 0.1, Math.PI * 0.9);
  ctx.moveTo(-14, 0);
  ctx.quadraticCurveTo(0, 8, 14, 0);
  ctx.stroke();

  if (shotStyle === "charge") {
    ctx.strokeStyle = "rgba(255, 242, 148, 0.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 25 + Math.sin(time / 70) * 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  drawReachRing(half);
}

function drawBallTrail(from, to, ease, style, half) {
  if (ease >= 1) return;

  const color = style === "charge" ? "rgba(255, 216, 64, 0.86)" : "rgba(255, 255, 255, 0.58)";
  const lift = Math.sin(ease * Math.PI) * 42;
  const current = {
    x: from.x + (to.x - from.x) * ease,
    y: from.y + (to.y - from.y) * ease - lift,
  };

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = style === "charge" ? 7 : 4;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.82;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo((from.x + to.x) / 2, Math.min(from.y, to.y) - half * 0.22, current.x, current.y);
  ctx.stroke();
  ctx.restore();
}

function seatCenter(seat, half) {
  return squarePoint(seat, { x: 0.5, y: 0.5 }, half);
}

function squarePoint(seat, position, half) {
  const square = SQUARES[seat] || SQUARES[0];
  const clean = cleanPosition(position);
  return {
    x: square.x * half + clean.x * half,
    y: square.y * half + clean.y * half,
  };
}

function playerPoint(player, seat, half) {
  const position = player.id === session.playerId && seat === localSeat ? localPosition : player.position;
  return squarePoint(seat, position, half);
}

function squareForPlayer(playerId) {
  return room?.seats.indexOf(playerId) ?? -1;
}

function drawReachRing(half) {
  if (!isMyTouch() || room.rally?.landing?.seat !== mySeat()) return;

  const center = squarePoint(room.rally.landing.seat, room.rally.landing, half);
  const radius = HIT_RADIUS * half;
  ctx.save();
  ctx.strokeStyle = isNearBall() ? "rgba(47, 143, 120, 0.82)" : "rgba(255, 255, 255, 0.86)";
  ctx.lineWidth = 4;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function resizeCanvas() {
  const rect = elements.canvas.getBoundingClientRect();
  const scale = deviceScale();
  const width = Math.max(320, Math.floor(rect.width * scale));
  const height = Math.max(320, Math.floor(rect.height * scale));
  if (elements.canvas.width !== width || elements.canvas.height !== height) {
    elements.canvas.width = width;
    elements.canvas.height = height;
  }
}

function cleanPosition(position) {
  const value = position && typeof position === "object" ? position : {};
  return {
    x: clamp(Number(value.x), 0.12, 0.88),
    y: clamp(Number(value.y), 0.12, 0.88),
  };
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, Number.isFinite(value) ? value : 0.5));
}

function mixColor(color, target, amount) {
  const from = hexToRgb(color);
  const to = hexToRgb(target);
  if (!from || !to) return color;
  const mixed = {
    r: Math.round(from.r + (to.r - from.r) * amount),
    g: Math.round(from.g + (to.g - from.g) * amount),
    b: Math.round(from.b + (to.b - from.b) * amount),
  };
  return `rgb(${mixed.r}, ${mixed.g}, ${mixed.b})`;
}

function hexToRgb(color) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color || "");
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function initials(name) {
  return String(name || "P")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "P";
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => {
    toast.remove();
  }, 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/[^#\w()-]/g, "");
}

function wireEvents() {
  elements.createRoomButton.addEventListener("click", () => createRoom().catch((error) => showToast(error.message)));
  elements.joinRoomButton.addEventListener("click", () => joinRoom().catch((error) => showToast(error.message)));
  elements.roomCodeInput.addEventListener("input", () => {
    elements.roomCodeInput.value = elements.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  });
  elements.roomCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      joinRoom().catch((error) => showToast(error.message));
    }
  });
  elements.copyRoomButton.addEventListener("click", async () => {
    const copied = await copyText(shareUrl());
    showToast(copied ? "Room link copied." : shareUrl());
  });
  elements.readyButton.addEventListener("click", () => {
    const me = myPlayer();
    sendAction({ type: "ready", ready: !me?.ready });
  });
  elements.startButton.addEventListener("click", () => sendAction({ type: "start" }));
  elements.botsButton.addEventListener("click", () => sendAction({ type: "bots" }));
  elements.leaveSeatButton.addEventListener("click", () => sendAction({ type: "leaveSeat" }));
  elements.leaveRoomButton.addEventListener("click", () => leaveRoom());
  elements.hitButton.addEventListener("click", () => attemptStrike({ targetSeat: selectedTargetSeat }));
  elements.faultButton.addEventListener("click", () => sendAction({ type: "fault", reason: "called themselves out" }));

  document.querySelectorAll(".style-button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedStyle = button.dataset.style;
      document.querySelectorAll(".style-button").forEach((item) => item.classList.toggle("active", item === button));
      renderTargets();
    });
  });

  elements.difficultyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      sendAction({ type: "difficulty", difficulty: button.dataset.difficulty });
    });
  });

  document.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)) return;
    const key = event.key.toLowerCase();
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s"].includes(key)) {
      pressedKeys.add(key);
      event.preventDefault();
    }
    if (event.code === "Space") {
      if (!spaceHeld) {
        spaceAimed = false;
        chargeTriggered = false;
      }
      spaceHeld = true;
      if (eHeld && !chargeTriggered) {
        chargeTriggered = true;
        spaceAimed = true;
        attemptStrike({ targetSeat: selectedTargetSeat ?? defaultTargetSeat(), charged: true });
      }
      event.preventDefault();
    }
    if (key === "e") {
      eHeld = true;
      if (spaceHeld && !chargeTriggered) {
        chargeTriggered = true;
        spaceAimed = true;
        attemptStrike({ targetSeat: selectedTargetSeat ?? defaultTargetSeat(), charged: true });
      }
    }
  });

  document.addEventListener("keyup", (event) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)) return;
    const key = event.key.toLowerCase();
    pressedKeys.delete(key);
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s"].includes(key)) {
      postMove(true);
    }
    if (key === "e") {
      eHeld = false;
    }
    if (event.code === "Space") {
      if (spaceHeld && !spaceAimed && !chargeTriggered) {
        attemptStrike({ random: true });
      }
      spaceHeld = false;
      spaceAimed = false;
      chargeTriggered = false;
      event.preventDefault();
    }
  });

  elements.canvas.addEventListener("pointerdown", moveToPointer);
  elements.canvas.addEventListener("pointermove", (event) => {
    if (event.buttons && !spaceHeld) moveToPointer(event);
  });
}

async function boot() {
  elements.playerName.value = storage.getItem(nameKey) || "";
  elements.playerColor.value = storage.getItem(colorKey) || "#287c91";
  elements.roomCodeInput.value = location.hash.replace("#", "").toUpperCase().slice(0, 4);
  wireEvents();
  await fetchConnectionInfo();
  drawCourt();
  renderEmptyCourt();

  if (elements.roomCodeInput.value) {
    try {
      await joinRoom(elements.roomCodeInput.value);
    } catch {
      saveSession({ code: null });
    }
  } else if (session.code && session.playerId) {
    try {
      const data = await api(`/api/rooms/${session.code}?playerId=${encodeURIComponent(session.playerId)}`);
      setRoom(data);
      history.replaceState(null, "", `#${session.code}`);
      startPolling();
    } catch {
      saveSession({ code: null, playerId: null });
    }
  }
}

window.addEventListener("beforeunload", () => {
  clearInterval(pollTimer);
  cancelAnimationFrame(animationFrame);
});

boot();
