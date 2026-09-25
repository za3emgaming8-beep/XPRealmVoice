import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT || 8080);
const API_KEY =
  process.env.API_KEY || 'CHANGE_ME_TO_A_LONG_RANDOM_KEY';

const publicSessions = new Map();

let pluginSocket = null;

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host}`
  );

  try {
    let file =
      url.pathname === '/' ||
      url.pathname.startsWith('/v/')
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

const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false
});

server.on('upgrade', (req, socket, head) => {
  let url;

  try {
    url = new URL(
      req.url,
      `http://${req.headers.host}`
    );
  } catch {
    socket.destroy();
    return;
  }

  if (
    url.pathname !== '/ws/plugin' &&
    url.pathname !== '/ws/client'
  ) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(
    req,
    socket,
    head,
    ws => {
      ws.role =
        url.pathname === '/ws/plugin'
          ? 'plugin'
          : 'client';

      ws.token =
        url.searchParams.get('token') || '';

      ws.isAlive = true;

      wss.emit(
        'connection',
        ws,
        req
      );
    }
  );
});

wss.on('connection', ws => {
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  if (ws.role === 'plugin') {
    handlePluginConnection(ws);
  } else {
    handleClientConnection(ws);
  }
});

function handlePluginConnection(ws) {
  if (
    pluginSocket &&
    pluginSocket !== ws &&
    pluginSocket.readyState === WebSocket.OPEN
  ) {
    try {
      pluginSocket.close(
        1000,
        'replaced by newer plugin connection'
      );
    } catch {}
  }

  pluginSocket = ws;

  console.log(
    'Minecraft plugin WebSocket connected.'
  );

  ws.on('message', data => {
    handlePluginMessage(data);
  });

  ws.on('close', () => {
    if (pluginSocket === ws) {
      pluginSocket = null;
    }

    console.log(
      'Minecraft plugin WebSocket disconnected.'
    );
  });

  ws.on('error', error => {
    console.log(
      'Plugin WebSocket error:',
      error.message
    );
  });
}

function handleClientConnection(ws) {
  const session =
    publicSessions.get(ws.token);

  if (!session) {
    ws.close(
      1008,
      'waiting for Minecraft session'
    );
    return;
  }

  if (
    session.browser &&
    session.browser !== ws
  ) {
    try {
      session.browser.close(
        1000,
        'replaced by newer browser connection'
      );
    } catch {}
  }

  session.browser = ws;
  ws.session = session;

  console.log(
    `Browser connected for ${session.name}.`
  );

  sendJson(
    ws,
    {
      type: 'hello',
      uuid: session.uuid,
      name: session.name
    }
  );

  ws.on('message', data => {
    handleClientMessage(ws, data);
  });

  ws.on('close', () => {
    if (
      ws.session &&
      ws.session.browser === ws
    ) {
      ws.session.browser = null;
    }

    console.log(
      `Browser disconnected for ${session.name}.`
    );
  });

  ws.on('error', error => {
    console.log(
      'Browser WebSocket error:',
      error.message
    );
  });
}

function handleClientMessage(ws, data) {
  if (!ws.session) {
    return;
  }

  if (Buffer.isBuffer(data)) {
    const plugin = pluginSocket;

    if (
      !plugin ||
      plugin.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const out = Buffer.concat([
      Buffer.from([0x03]),
      uuidBuffer(ws.session.uuid),
      data
    ]);

    try {
      plugin.send(out);
    } catch {}
    return;
  }

  try {
    const msg =
      JSON.parse(data.toString());

    if (
      msg.type === 'browser_state'
    ) {
      const plugin = pluginSocket;

      if (
        plugin &&
        plugin.readyState === WebSocket.OPEN
      ) {
        sendJson(
          plugin,
          {
            ...msg,
            uuid: ws.session.uuid
          }
        );
      }
    }
  } catch {}
}

function handlePluginMessage(data) {
  if (Buffer.isBuffer(data)) {
    handlePluginBinary(data);
    return;
  }

  try {
    const msg =
      JSON.parse(data.toString());

    if (msg.type === 'plugin_auth') {
      if (msg.key !== API_KEY) {
        console.log(
          'Plugin authentication failed.'
        );

        if (pluginSocket) {
          pluginSocket.close(
            1008,
            'bad key'
          );
        }

        return;
      }

      console.log(
        'Minecraft plugin authenticated.'
      );

      return;
    }

    if (msg.type === 'session') {
      updateSession(msg);
      return;
    }

    if (msg.type === 'close_session') {
      closeSession(msg.uuid);
      return;
    }

    if (msg.type === 'state') {
      sendStateToBrowser(msg);
      return;
    }
  } catch {}
}

function updateSession(msg) {
  if (
    !msg.token ||
    !msg.uuid ||
    !msg.name
  ) {
    return;
  }

  const existing =
    publicSessions.get(msg.token);

  const session = {
    uuid: msg.uuid,
    name: msg.name,
    browser:
      existing?.browser || null
  };

  publicSessions.set(
    msg.token,
    session
  );

  if (
    session.browser &&
    session.browser.readyState === WebSocket.OPEN
  ) {
    session.browser.session =
      session;

    sendJson(
      session.browser,
      {
        type: 'hello',
        uuid: session.uuid,
        name: session.name
      }
    );
  }

  console.log(
    `Session registered: ${msg.name}`
  );
}

function closeSession(uuid) {
  for (
    const [token, session]
    of publicSessions
  ) {
    if (session.uuid !== uuid) {
      continue;
    }

    try {
      session.browser?.close(
        1000,
        'voice session closed'
      );
    } catch {}

    publicSessions.delete(token);

    console.log(
      `Session closed: ${session.name}`
    );
  }
}

function sendStateToBrowser(msg) {
  const session =
    [...publicSessions.values()]
      .find(
        x => x.uuid === msg.uuid
      );

  if (
    session?.browser &&
    session.browser.readyState === WebSocket.OPEN
  ) {
    sendJson(
      session.browser,
      msg
    );
  }
}

function handlePluginBinary(data) {
  const buf = Buffer.from(data);

  if (buf.length < 33) {
    return;
  }

  const type = buf[0];

  if (
    type !== 0x02 &&
    type !== 0x11
  ) {
    return;
  }

  const target =
    uuidFromBuffer(
      buf.subarray(1, 17)
    );

  const sender =
    uuidFromBuffer(
      buf.subarray(17, 33)
    );

  const pcm =
    buf.subarray(33);

  const session =
    [...publicSessions.values()]
      .find(
        x => x.uuid === target
      );

  if (
    !session?.browser ||
    session.browser.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  const out = Buffer.concat([
    Buffer.from([0x10]),
    uuidBuffer(sender),
    pcm
  ]);

  try {
    session.browser.send(out);
  } catch {}
}

function sendJson(ws, object) {
  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  try {
    ws.send(
      JSON.stringify(object)
    );
  } catch {}
}

function uuidBuffer(uuid) {
  return Buffer.from(
    uuid.replaceAll('-', ''),
    'hex'
  );
}

function uuidFromBuffer(buf) {
  const h =
    buf.toString('hex');

  return (
    `${h.slice(0, 8)}-` +
    `${h.slice(8, 12)}-` +
    `${h.slice(12, 16)}-` +
    `${h.slice(16, 20)}-` +
    `${h.slice(20)}`
  );
}

/*
 * Keep WebSocket connections alive.
 *
 * Render/proxies may terminate connections
 * that appear idle. Ping every 20 seconds.
 */
const heartbeatTimer =
  setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        try {
          ws.terminate();
        } catch {}

        continue;
      }

      ws.isAlive = false;

      try {
        ws.ping();
      } catch {}
    }
  }, 20000);

heartbeatTimer.unref();

server.on('error', error => {
  console.error(
    'HTTP server error:',
    error
  );
});

process.on('SIGTERM', () => {
  clearInterval(heartbeatTimer);

  for (const ws of wss.clients) {
    try {
      ws.close(
        1001,
        'server shutting down'
      );
    } catch {}
  }

  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  clearInterval(heartbeatTimer);

  server.close(() => {
    process.exit(0);
  });
});

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `XPRealmVoice web bridge listening on :${PORT}`
    );
  }
);
