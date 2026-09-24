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
let pcmBuffer = new Int16Array(0);
let muted = false;
let deafened = false;
const playerNames = new Map();
const playback = [];

if (!token) {
  statusEl.textContent = 'Invalid or missing voice session.';
  enableBtn.disabled = true;
} else connect();

function connect(){
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws/client?token=${encodeURIComponent(token)}`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => statusEl.textContent = 'Connected. Enable your microphone to begin.';
  ws.onclose = () => statusEl.textContent = 'Disconnected from XPRealm Voice.';
  ws.onmessage = e => typeof e.data === 'string' ? control(JSON.parse(e.data)) : receiveAudio(new Uint8Array(e.data));
}

async function enableMic(){
  if (!audioContext) audioContext = new AudioContext({sampleRate:48000});
  await audioContext.resume();
  micStream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  micSource = audioContext.createMediaStreamSource(micStream);
  processor = audioContext.createScriptProcessor(960,1,1);
  processor.onaudioprocess = e => {
    if (muted || !ws || ws.readyState !== 1) return;
    const input = e.inputBuffer.getChannelData(0);
    const block = new Int16Array(input.length);
    for (let i=0;i<input.length;i++) block[i]=Math.max(-1,Math.min(1,input[i]))*32767;
    sendPcm(block);
  };
  micSource.connect(processor);
  processor.connect(audioContext.destination);
  statusEl.textContent = 'Microphone enabled.';
}

enableBtn.onclick = () => enableMic().catch(err => statusEl.textContent = 'Microphone permission failed: ' + err.message);
muteBtn.onclick = () => { muted = !muted; muteBtn.textContent = muted ? '🎤 Unmute' : '🎤 Mute'; sendState(); };
deafenBtn.onclick = () => { deafened = !deafened; deafenBtn.textContent = deafened ? '🔇 Undeafen' : '🔊 Deafen'; sendState(); };

function sendPcm(samples){
  const bytes = new Uint8Array(samples.buffer.slice(samples.byteOffset,samples.byteOffset+samples.byteLength));
  ws.send(bytes);
}
function sendState(){
  if(ws?.readyState===1) ws.send(JSON.stringify({type:'browser_state',muted,deafened}));
}
function control(msg){
  if(msg.type==='hello') statusEl.textContent=`Connected as ${msg.name}.`;
  if(msg.type==='state'){
    if(msg.muted!==undefined) muted=!!msg.muted;
    if(msg.deafened!==undefined) deafened=!!msg.deafened;
  }
}
function receiveAudio(bytes){
  if(deafened) return;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if(dv.getUint8(0)!==0x10 || bytes.byteLength<17) return;
  const sender = bytesToUuid(bytes.slice(1,17));
  playerNames.set(sender,sender.slice(0,8));
  updatePlayers();
  const pcmBytes = bytes.slice(17);
  const pcm = new Int16Array(pcmBytes.buffer,pcmBytes.byteOffset,Math.floor(pcmBytes.byteLength/2));
  playback.push(pcm.slice());
  playQueue();
}
function playQueue(){
  if(!audioContext || playback.playing) return;
  playback.playing=true;
  const run=()=>{
    if(!playback.length){playback.playing=false;return;}
    const pcm=playback.shift();
    const f=new Float32Array(pcm.length);
    for(let i=0;i<pcm.length;i++) f[i]=pcm[i]/32768;
    const buf=audioContext.createBuffer(1,f.length,48000);
    buf.copyToChannel(f,0);
    const src=audioContext.createBufferSource(); src.buffer=buf; src.connect(audioContext.destination); src.onended=run; src.start();
  }; run();
}
function updatePlayers(){ playersEl.innerHTML=[...playerNames.values()].map(n=>`<span class="pill">🎙 ${n}</span>`).join(' '); }
function bytesToUuid(b){ const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join(''); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; }
