const params = new URLSearchParams(location.search);
const token = params.get('token');

const statusEl = document.querySelector('#status');
const enableBtn = document.querySelector('#enable');
const muteBtn = document.querySelector('#mute');
const deafenBtn = document.querySelector('#deafen');
const playersEl = document.querySelector('#players');

let ws;
let audioContext;
let micStream;
let micSource;
let processor;

let muted = false;
let deafened = false;

const playerNames = new Map();
const playback = [];

let transmitBuffer = new Int16Array(0);

const VOICE_FRAME_SIZE = 960;

let reconnectTimer = null;
let reconnectDelay = 1000;
let manuallyStopped = false;

if (!token) {
  statusEl.textContent =
    'Invalid or missing voice session.';

  enableBtn.disabled = true;
} else {
  connect();
}

function connect() {
  if (!token || manuallyStopped) {
    return;
  }

  if (
    ws &&
    (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  const proto =
    location.protocol === 'https:'
      ? 'wss:'
      : 'ws:';

  statusEl.textContent =
    'Connecting to XPRealm Voice...';

  ws = new WebSocket(
    `${proto}//${location.host}/ws/client?token=${encodeURIComponent(token)}`
  );

  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    reconnectDelay = 1000;

    statusEl.textContent =
      'Connected.';

    sendState();

    if (audioContext) {
      audioContext.resume().catch(() => {});
    }

    playQueue();
  };

  ws.onclose = () => {
    if (manuallyStopped) {
      statusEl.textContent =
        'Disconnected from XPRealm Voice.';
      return;
    }

    statusEl.textContent =
      'Voice connection lost. Reconnecting...';

    scheduleReconnect();
  };

  ws.onerror = () => {
    try {
      ws.close();
    } catch {}
  };

  ws.onmessage = e => {
    if (typeof e.data === 'string') {
      try {
        control(JSON.parse(e.data));
      } catch {}
    } else {
      receiveAudio(
        new Uint8Array(e.data)
      );
    }
  };
}

function scheduleReconnect() {
  if (
    reconnectTimer ||
    manuallyStopped
  ) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();

    reconnectDelay =
      Math.min(
        reconnectDelay * 2,
        10000
      );
  }, reconnectDelay);
}

async function enableMic() {
  manuallyStopped = false;

  if (!audioContext) {
    audioContext =
      new AudioContext({
        sampleRate: 48000
      });
  }

  await audioContext.resume();

  if (!micStream) {
    micStream =
      await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

    micSource =
      audioContext.createMediaStreamSource(
        micStream
      );

    processor =
      audioContext.createScriptProcessor(
        1024,
        1,
        1
      );

    processor.onaudioprocess = e => {
      if (
        muted ||
        !ws ||
        ws.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      const input =
        e.inputBuffer.getChannelData(0);

      const block =
        new Int16Array(input.length);

      for (
        let i = 0;
        i < input.length;
        i++
      ) {
        block[i] =
          Math.max(
            -1,
            Math.min(1, input[i])
          ) * 32767;
      }

      appendTransmitSamples(block);
    };

    micSource.connect(processor);

    processor.connect(
      audioContext.destination
    );
  }

  statusEl.textContent =
    'Microphone enabled.';

  playQueue();
}

enableBtn.onclick = () => {
  enableMic().catch(
    err => {
      statusEl.textContent =
        'Microphone permission failed: ' +
        err.message;
    }
  );
};

muteBtn.onclick = () => {
  muted = !muted;

  muteBtn.textContent =
    muted
      ? '🎤 Unmute'
      : '🎤 Mute';

  sendState();
};

deafenBtn.onclick = () => {
  deafened = !deafened;

  deafenBtn.textContent =
    deafened
      ? '🔇 Undeafen'
      : '🔊 Deafen';

  if (deafened) {
    playback.length = 0;
  }

  sendState();
};

function appendTransmitSamples(samples) {
  const combined =
    new Int16Array(
      transmitBuffer.length +
      samples.length
    );

  combined.set(
    transmitBuffer,
    0
  );

  combined.set(
    samples,
    transmitBuffer.length
  );

  transmitBuffer = combined;

  while (
    transmitBuffer.length >=
    VOICE_FRAME_SIZE
  ) {
    const frame =
      transmitBuffer.slice(
        0,
        VOICE_FRAME_SIZE
      );

    transmitBuffer =
      transmitBuffer.slice(
        VOICE_FRAME_SIZE
      );

    sendPcm(frame);
  }
}

function sendPcm(samples) {
  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  const bytes =
    new Uint8Array(
      samples.buffer,
      samples.byteOffset,
      samples.byteLength
    );

  ws.send(bytes);
}

function sendState() {
  if (
    ws?.readyState === WebSocket.OPEN
  ) {
    ws.send(
      JSON.stringify({
        type: 'browser_state',
        muted,
        deafened
      })
    );
  }
}

function control(msg) {
  if (msg.type === 'hello') {
    statusEl.textContent =
      `Connected as ${msg.name}.`;

    sendState();
    playQueue();
  }

  if (msg.type === 'state') {
    if (
      msg.muted !== undefined
    ) {
      muted = !!msg.muted;

      muteBtn.textContent =
        muted
          ? '🎤 Unmute'
          : '🎤 Mute';
    }

    if (
      msg.deafened !== undefined
    ) {
      deafened = !!msg.deafened;

      deafenBtn.textContent =
        deafened
          ? '🔇 Undeafen'
          : '🔊 Deafen';

      if (deafened) {
        playback.length = 0;
      }
    }
  }
}

function receiveAudio(bytes) {
  if (deafened) {
    return;
  }

  if (bytes.byteLength < 17) {
    return;
  }

  const dv =
    new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    );

  if (
    dv.getUint8(0) !== 0x10
  ) {
    return;
  }

  const sender =
    bytesToUuid(
      bytes.slice(1, 17)
    );

  playerNames.set(
    sender,
    sender.slice(0, 8)
  );

  updatePlayers();

  const pcmBytes =
    bytes.slice(17);

  if (
    pcmBytes.byteLength % 2 !== 0
  ) {
    return;
  }

  const pcm =
    new Int16Array(
      pcmBytes.buffer,
      pcmBytes.byteOffset,
      pcmBytes.byteLength / 2
    );

  playback.push(
    pcm.slice()
  );

  playQueue();
}

function playQueue() {
  if (
    !audioContext ||
    playback.playing
  ) {
    return;
  }

  playback.playing = true;

  const run = () => {
    if (!playback.length) {
      playback.playing = false;
      return;
    }

    if (deafened) {
      playback.length = 0;
      playback.playing = false;
      return;
    }

    const pcm =
      playback.shift();

    const f =
      new Float32Array(
        pcm.length
      );

    for (
      let i = 0;
      i < pcm.length;
      i++
    ) {
      f[i] =
        pcm[i] / 32768;
    }

    const buf =
      audioContext.createBuffer(
        1,
        f.length,
        48000
      );

    buf.copyToChannel(
      f,
      0
    );

    const src =
      audioContext.createBufferSource();

    src.buffer = buf;

    src.connect(
      audioContext.destination
    );

    src.onended = run;

    src.start();
  };

  run();
}

function updatePlayers() {
  playersEl.innerHTML =
    [...playerNames.values()]
      .map(
        n =>
          `<span class="pill">🎙 ${n}</span>`
      )
      .join(' ');
}

function bytesToUuid(b) {
  const h =
    [...b]
      .map(
        x =>
          x.toString(16)
            .padStart(2, '0')
      )
      .join('');

  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
