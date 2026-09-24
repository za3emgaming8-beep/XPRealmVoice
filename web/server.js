import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.API_KEY || 'CHANGE_ME_TO_A_LONG_RANDOM_KEY';
const publicSessions = new Map(); // token -> { uuid, name, browser }
let pluginSocket = null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    let file = url.pathname === '/' || url.pathname.startsWith('/v/') ? '/index.html' : url.pathname;
    if (file.startsWith('/?')) file = '/index.html';
    const content = await readFile(new URL(`./public${file}`, import.meta.url));
    const ext = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200, { 'Content-Type': ext, 'Cache-Control': 'no-store' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws/plugin' && url.pathname !== '/ws/client') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.role = url.pathname === '/ws/plugin' ? 'plugin' : 'client';
  ws.token = url.searchParams.get("token") || url.pathname.split("/")[2];
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', ws => {
  if (ws.role === 'plugin') {
    pluginSocket = ws;
    ws.on('message', data => handlePluginMessage(ws, data));
    ws.on('close', () => { if (pluginSocket === ws) pluginSocket = null; });
    return;
  }

  ws.session = publicSessions.get(ws.token);
  if (!ws.session) {
    ws.close(1008, 'invalid session');
    return;
  }
  ws.session.browser = ws;
  ws.send(JSON.stringify({ type: 'hello', uuid: ws.session.uuid, name: ws.session.name }));

  ws.on('message', data => {
    if (Buffer.isBuffer(data)) {
      // [0x03][bedrock UUID 16][PCM]
      if (!pluginSocket || pluginSocket.readyState !== 1) return;
      const out = Buffer.concat([Buffer.from([0x03]), uuidBuffer(ws.session.uuid), data]);
      pluginSocket.send(out);
      return;
    }
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'browser_state' && pluginSocket?.readyState === 1) {
        pluginSocket.send(JSON.stringify(msg));
      }
    } catch {}
  });
  ws.on('close', () => {
    if (ws.session?.browser === ws) ws.session.browser = null;
  });
});

function handlePluginMessage(ws, data) {
  if (Buffer.isBuffer(data)) {
    const buf = Buffer.from(data);
    if (buf[0] !== 0x02) return;
    const target = uuidFromBuffer(buf.subarray(1, 17));
    const sender = uuidFromBuffer(buf.subarray(17, 33));
    const pcm = buf.subarray(33);
    const s = [...publicSessions.values()].find(x => x.uuid === target);
    if (!s?.browser || s.browser.readyState !== 1) return;
    const out = Buffer.concat([
      Buffer.from([0x10]),
      uuidBuffer(sender),
      pcm
    ]);
    s.browser.send(out);
    return;
  }

  try {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'plugin_auth') {
      if (msg.key !== API_KEY) ws.close(1008, 'bad key');
      return;
    }
    if (msg.type === 'session') {
      publicSessions.set(msg.token, { uuid: msg.uuid, name: msg.name, browser: null });
      return;
    }
    if (msg.type === 'close_session') {
      for (const [token, s] of publicSessions) {
        if (s.uuid === msg.uuid) {
          try { s.browser?.close(); } catch {}
          publicSessions.delete(token);
        }
      }
      return;
    }
    if (msg.type === 'state') {
      const s = [...publicSessions.values()].find(x => x.uuid === msg.uuid);
      s?.browser?.send(JSON.stringify(msg));
    }
  } catch {}
}

function uuidBuffer(uuid) {
  const hex = uuid.replaceAll('-', '');
  return Buffer.from(hex, 'hex');
}
function uuidFromBuffer(buf) {
  const h = buf.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

server.listen(PORT, () => console.log(`XPRealmVoice web bridge listening on :${PORT}`));
