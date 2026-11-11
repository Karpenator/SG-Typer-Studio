// What the user's Discord friends see while they work in SG Typer Studio: Discord's Rich Presence,
// spoken to the Discord app on this computer through its local socket, as its own libraries do.
// Nothing goes on the network from here. Without Discord running, nothing happens, and it's
// tried again now and then. The page says what it is on (Settings > Discord activity); the rest
// of the activity is set here and cannot come from the page. No remote artwork or site link is used.

const net = require("net");

// A separate Discord application id can be supplied for SG Typer Studio branding. The legacy id
// keeps Rich Presence working for existing installations; no website or external icon is used.
const CLIENT_ID = process.env.SG_DISCORD_ID || process.env.TYPER_DISCORD_ID || "1569214773931941968";
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
// Discord takes 5 changes every 20 seconds
const SEND_GAP = 4000;
const RETRY_EVERY = 30 * 1000;

const socketPath = (index) => `\\\\?\\pipe\\discord-ipc-${index}`;

const encode = (op, data) => {
  const body = Buffer.from(JSON.stringify(data), "utf8");
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
};

// Discord wants 2 to 128 characters in each line
const line = (text) => {
  if (typeof text !== "string") return undefined;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  const cut = Array.from(clean).length > 128 ? `${Array.from(clean).slice(0, 127).join("")}…` : clean;
  return cut.length < 2 ? `${cut} ` : cut;
};

let socket = null;
let ready = false;
let connecting = false;
let wanted = null;
let sent = undefined;
let lastSend = 0;
let sendTimer = null;
let retryTimer = null;
let nonce = 0;
const started = Date.now();

const close = () => {
  ready = false;
  sent = undefined;
  if (socket) {
    socket.removeAllListeners();
    socket.on("error", () => {});
    socket.destroy();
  }
  socket = null;
};

const retryLater = () => {
  clearTimeout(retryTimer);
  if (wanted) retryTimer = setTimeout(connect, RETRY_EVERY);
};

const activityOf = (wish) => ({
  type: 0,
  details: line(wish.details),
  state: line(wish.state),
  timestamps: { start: started },
  assets: { large_text: "SG Typer Studio" },
  instance: false,
});

const send = () => {
  clearTimeout(sendTimer);
  sendTimer = null;
  if (!ready || !socket) return;
  const key = JSON.stringify(wanted);
  if (key === sent) return;
  const wait = lastSend + SEND_GAP - Date.now();
  if (wait > 0) {
    sendTimer = setTimeout(send, wait);
    return;
  }
  lastSend = Date.now();
  sent = key;
  nonce += 1;
  socket.write(encode(OP.FRAME, {
    cmd: "SET_ACTIVITY",
    args: { pid: process.pid, activity: wanted ? activityOf(wanted) : undefined },
    nonce: String(nonce),
  }));
};

// Frames can arrive cut in pieces, or several at once
const reader = () => {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 8) {
      const op = pending.readInt32LE(0);
      const length = pending.readInt32LE(4);
      if (pending.length < 8 + length) return;
      let data = null;
      try {
        data = JSON.parse(pending.subarray(8, 8 + length).toString("utf8"));
      } catch (error) {}
      pending = pending.subarray(8 + length);
      if (op === OP.PING) socket.write(encode(OP.PONG, data));
      else if (op === OP.CLOSE) {
        console.warn("Discord:", data && data.message);
        close();
        retryLater();
        return;
      } else if (op === OP.FRAME && data) {
        if (data.evt === "READY") {
          ready = true;
          send();
        } else if (data.evt === "ERROR") console.warn("Discord:", data.data && data.data.message);
      }
    }
  };
};

// Discord listens on the first of ten sockets that was free
const tryAt = (index) => new Promise((resolve) => {
  const one = net.createConnection(socketPath(index));
  const done = (ok) => {
    one.removeAllListeners("connect");
    one.removeAllListeners("error");
    if (!ok) one.destroy();
    resolve(ok ? one : null);
  };
  one.once("connect", () => done(true));
  one.once("error", () => done(false));
});

const connect = async () => {
  if (!CLIENT_ID || !wanted || socket || connecting) return;
  connecting = true;
  let found = null;
  for (let index = 0; index < 10 && !found; index += 1) found = await tryAt(index);
  connecting = false;
  if (!found) {
    retryLater();
    return;
  }
  if (!wanted) {
    found.destroy();
    return;
  }
  socket = found;
  socket.on("data", reader());
  socket.on("error", () => {});
  socket.on("close", () => {
    close();
    retryLater();
  });
  socket.write(encode(OP.HANDSHAKE, { v: 1, client_id: CLIENT_ID }));
};

// { details, state } as the page says it, or null: nothing shown, and Discord is left alone
const set = (wish) => {
  const clean = wish && typeof wish === "object" ? { details: line(wish.details), state: line(wish.state) } : null;
  if (!clean) {
    wanted = null;
    clearTimeout(retryTimer);
    clearTimeout(sendTimer);
    close();
    return;
  }
  wanted = clean;
  if (ready) send();
  else connect();
};

const stop = () => set(null);

module.exports = { set, stop, available: Boolean(CLIENT_ID) };
