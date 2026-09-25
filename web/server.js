import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.API_KEY || 'CHANGE_ME_TO_A_LONG_RANDOM_KEY';

const publicSessions = new Map();
let pluginSocket = null;

const copyPage = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>XPRealm Voice</title>
<style>
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #10131a;
  color: white;
  font-family: Arial, sans-serif;
}
.card {
  width: min(90%, 420px);
  background: #191e28;
  border-radius: 18px;
  padding: 28px;
  text-align: center;
  box-sizing: border-box;
}
h1 {
  margin-top: 0;
}
#link {
  word-break: break-all;
  background: #0e1117;
  padding: 14px;
  border-radius: 10px;
  margin: 18px 0;
  font-size: 14px;
}
button {
  width: 100%;
  border: 0;
  border-radius: 12px;
  padding: 15px;
  font-size: 17px;
  font-weight: bold;
  background: #42a5ff;
  color: white;
}
#status {
  margin-top: 14px;
  min-height: 20px;
}
</style>
</head>
<body>
<div class="card">
  <h1>🎙️ XPRealm Voice</h1>
  <p>Your voice link is ready.</p>
  <div id="link"></div>
  <button id="copy">📋 Copy Link</button>
  <div id="status"></div>
</div>

<script>
const params = new URLSearchParams(location.search);
const token = params.get('token');

if (!token) {
  document.getElementById('link').textContent = 'Invalid or missing token.';
  document.getElementById('copy').style.display = 'none';
} else {
  const link = location.origin + '/?token=' + encodeURIComponent(token);
  document.getElementById('link').textContent = link;

  document.getElementById('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      document.getElementById('status').textContent = '✅ Copied!';
    } catch {
      document.getElementById('status').textContent =
        'Copy was blocked. Select the link above and copy it manually.';
    }
  };
}
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === '/copy') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(copyPage);
      return;
    }

    let file =
      url.pathname === '/' || url.pathname.startsWith('/v/')
        ? '/index.html'
        : url.pathname;

    const content = await readFile(
      new URL(`./public${file}`, import.meta.url)
    );

    const ext = file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : 'text/html';

    res.writeHead(200, {
      'Content-Type': ext,
      'Cache-Control': 'no-store'
    });

    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (
    url.pathname !== '/ws/plugin' &&
    url.pathname !== '/ws/client'
  ) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => {
    ws.role = url.pathname === '/ws/plugin'
      ? 'plugin'
      : 'client';

    ws.token =
      url.searchParams.get('token') ||
      url.pathname.split('/')[2];

    wss.emit('connection', ws, req);
  });
});

wss.on('connection', ws => {
  if (ws.role === 'plugin') {
    pluginSocket = ws;

    ws.on('message', data => {
      handlePluginMessage(ws, data);
    });

    ws.on('close', () => {
      if (pluginSocket === ws) {
        pluginSocket = null;
      }
    });

    return;
  }

  ws.session = publicSessions.get(ws.token);

  if (!ws.session) {
    ws.close(1008, 'invalid session');
    return;
  }

  ws.session.browser = ws;

  ws.send(JSON.stringify({
    type: 'hello',
    uuid: ws.session.uuid,
    name: ws.session.name
  }));

  ws.on('message', data => {
    if (Buffer.isBuffer(data)) {
      if (!pluginSocket || pluginSocket.readyState !== 1) return;

      const out = Buffer.concat([
        Buffer.from([0x03]),
        uuidBuffer(ws.session.uuid),
        data
      ]);

      pluginSocket.send(out);
      return;
    }

    try {
      const msg = JSON.parse(data.toString());

      if (
        msg.type === 'browser_state' &&
        pluginSocket?.readyState === 1
      ) {
        pluginSocket.send(JSON.stringify({
          ...msg,
          uuid: ws.session.uuid
        }));
      }
    } catch {}
  });

  ws.on('close', () => {
    if (ws.session?.browser === ws) {
      ws.session.browser = null;
    }
  });
});

function handlePluginMessage(ws, data) {
  if (Buffer.isBuffer(data)) {
    const buf = Buffer.from(data);

    if (buf.length < 33) return;

    if (buf[0] === 0x02) {
      const target = uuidFromBuffer(
        buf.subarray(1, 17)
      );

      const sender = uuidFromBuffer(
        buf.subarray(17, 33)
      );

      const pcm = buf.subarray(33);

      const session = [...publicSessions.values()]
        .find(x => x.uuid === target);

      if (
        !session?.browser ||
        session.browser.readyState !== 1
      ) {
        return;
      }

      const out = Buffer.concat([
        Buffer.from([0x10]),
        uuidBuffer(sender),
        pcm
      ]);

      session.browser.send(out);
      return;
    }

    if (buf[0] === 0x11) {
      const target = uuidFromBuffer(
        buf.subarray(1, 17)
      );

      const sender = uuidFromBuffer(
        buf.subarray(17, 33)
      );

      const pcm = buf.subarray(33);

      const session = [...publicSessions.values()]
        .find(x => x.uuid === target);

      if (
        !session?.browser ||
        session.browser.readyState !== 1
      ) {
        return;
      }

      const out = Buffer.concat([
        Buffer.from([0x10]),
        uuidBuffer(sender),
        pcm
      ]);

      session.browser.send(out);
      return;
    }

    return;
  }

  try {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'plugin_auth') {
      if (msg.key !== API_KEY) {
        ws.close(1008, 'bad key');
      }
      return;
    }

    if (msg.type === 'session') {
      publicSessions.set(msg.token, {
        uuid: msg.uuid,
        name: msg.name,
        browser: null
      });
      return;
    }

    if (msg.type === 'close_session') {
      for (const [token, session] of publicSessions) {
        if (session.uuid === msg.uuid) {
          try {
            session.browser?.close();
          } catch {}

          publicSessions.delete(token);
        }
      }
      return;
    }

    if (msg.type === 'state') {
      const session = [...publicSessions.values()]
        .find(x => x.uuid === msg.uuid);

      session?.browser?.send(JSON.stringify(msg));
    }
  } catch {}
}

function uuidBuffer(uuid) {
  return Buffer.from(
    uuid.replaceAll('-', ''),
    'hex'
  );
}

function uuidFromBuffer(buf) {
  const h = buf.toString('hex');

  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

server.listen(PORT, () => {
  console.log(
    `XPRealmVoice web bridge listening on :${PORT}`
  );
});
