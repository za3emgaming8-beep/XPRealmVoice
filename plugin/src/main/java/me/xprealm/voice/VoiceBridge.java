package me.xprealm.voice;

import de.maxhenkel.voicechat.api.VoicechatConnection;
import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.audiochannel.LocationalAudioChannel;
import de.maxhenkel.voicechat.api.events.MicrophonePacketEvent;
import de.maxhenkel.voicechat.api.packets.MicrophonePacket;
import de.maxhenkel.voicechat.api.opus.OpusDecoder;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

public final class VoiceBridge {
    private static final byte BEDROCK_PCM = 0x03;
    private static final byte JAVA_PCM = 0x10;

    private final XPRealmVoicePlugin plugin;
    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final AtomicBoolean connecting = new AtomicBoolean(false);
    private volatile WebSocket socket;
    private volatile VoicechatServerApi svc;
    private volatile VoiceManager manager;

    public VoiceBridge(XPRealmVoicePlugin plugin) { this.plugin = plugin; }
    public void setManager(VoiceManager manager) { this.manager = manager; }
    public void setSvc(VoicechatServerApi svc) { this.svc = svc; }

    public void start() { connect(); }
    public void stop() { if (socket != null) socket.abort(); }

    private void connect() {
        if (!connecting.compareAndSet(false, true)) return;
        String url = plugin.getConfig().getString("bridge.websocket-url", "ws://127.0.0.1:8080/ws/plugin");
        httpClient.newWebSocketBuilder().buildAsync(URI.create(url), new WebSocket.Listener() {
            @Override public void onOpen(WebSocket ws) {
                socket = ws; connecting.set(false);
                String key = plugin.getConfig().getString("bridge.api-key", "CHANGE_ME");
                ws.sendText("{\"type\":\"plugin_auth\",\"key\":\"" + escape(key) + "\"}", true);
                ws.request(1);
            }
            @Override public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
                if (data.toString().contains("\"type\":\"ping\"")) ws.sendText("{\"type\":\"pong\"}", true);
                ws.request(1); return null;
            }
            @Override public CompletionStage<?> onBinary(WebSocket ws, ByteBuffer data, boolean last) {
                handleBinary(data); ws.request(1); return null;
            }
            @Override public void onError(WebSocket ws, Throwable error) { connecting.set(false); }
            @Override public CompletionStage<?> onClose(WebSocket ws, int code, String reason) {
                connecting.set(false); socket = null; Bukkit.getScheduler().runTaskLater(plugin, VoiceBridge.this::connect, 60L); return null;
            }
        });
    }

    private void handleBinary(ByteBuffer raw) {
        ByteBuffer b = raw.slice().order(ByteOrder.BIG_ENDIAN);
        if (!b.hasRemaining() || b.get() != BEDROCK_PCM || b.remaining() < 16) return;
        UUID senderId = new UUID(b.getLong(), b.getLong());
        byte[] bytes = new byte[b.remaining()]; b.get(bytes);
        if (bytes.length == 0 || bytes.length % 2 != 0) return;
        short[] pcm = new short[bytes.length / 2];
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(pcm);
        VoiceManager vm = manager;
        VoiceSession session = vm == null ? null : vm.session(senderId);
        if (session == null || session.muted || session.bedrockToJavaChannel == null || session.encoder == null || pcm.length != 960) return;
        byte[] opus = session.encoder.encode(pcm);
        if (opus != null) session.bedrockToJavaChannel.send(opus);
    }

    /** Captures Java players' normal SVC microphone packets and mirrors them to nearby Bedrock sessions. */
    public void onJavaMicrophonePacket(MicrophonePacketEvent event) {
        VoicechatConnection senderConnection = event.getSenderConnection();
        if (senderConnection == null) return;
        de.maxhenkel.voicechat.api.ServerPlayer sender = senderConnection.getPlayer();
        if (sender == null) return;
        UUID senderId = sender.getUuid();
        Player bukkitSender = Bukkit.getPlayer(senderId);
        if (bukkitSender == null) return;
        MicrophonePacket packet = event.getPacket();
        byte[] opus = packet.getOpusEncodedData();
        if (opus == null || opus.length == 0) return;
        VoiceManager vm = manager;
        if (vm == null) return;
        double distance = vm.getSvc() != null ? vm.getSvc().getVoiceChatDistance() : plugin.getConfig().getDouble("bridge.fallback-distance", 48.0);
        OpusDecoder decoder = vm.getSvc() != null ? vm.getSvc().createDecoder() : null;
        if (decoder == null) return;
        try {
            short[] pcm = decoder.decode(opus);
            if (pcm == null || pcm.length == 0) return;
            for (VoiceSession session : vm.getSessions().values()) {
                if (session.deafened) continue;
                Player bedrock = Bukkit.getPlayer(session.playerId);
                if (bedrock == null) continue;
                if (!sameWorld(bukkitSender, bedrock)) continue;
                if (bukkitSender.getLocation().distanceSquared(bedrock.getLocation()) > distance * distance) continue;
                sendJavaPcm(session.playerId, senderId, pcm);
            }
        } finally { decoder.close(); }
    }

    private boolean sameWorld(Player a, Player b) { return a.getWorld().getUID().equals(b.getWorld().getUID()); }

    private void sendJavaPcm(UUID targetBedrock, UUID senderJava, short[] pcm) {
        WebSocket ws = socket;
        if (ws == null || ws.isOutputClosed()) return;
        ByteBuffer out = ByteBuffer.allocate(1 + 16 + 16 + pcm.length * 2).order(ByteOrder.BIG_ENDIAN);
        out.put(JAVA_PCM).putLong(targetBedrock.getMostSignificantBits()).putLong(targetBedrock.getLeastSignificantBits());
        out.putLong(senderJava.getMostSignificantBits()).putLong(senderJava.getLeastSignificantBits());
        for (short s : pcm) out.order(ByteOrder.LITTLE_ENDIAN).putShort(s).order(ByteOrder.BIG_ENDIAN);
        out.flip(); ws.sendBinary(out, true);
    }

    public void registerSession(VoiceSession session, String name) {
        sendText("{\"type\":\"session\",\"uuid\":\"" + session.playerId + "\",\"name\":\"" + escape(name) + "\",\"token\":\"" + session.token + "\"}");
    }
    public void closeSession(UUID id) { sendText("{\"type\":\"close_session\",\"uuid\":\"" + id + "\"}"); }
    public void setMuted(UUID id, boolean muted) { sendText("{\"type\":\"state\",\"uuid\":\"" + id + "\",\"muted\":" + muted + "}"); }
    public void setDeafened(UUID id, boolean deafened) { sendText("{\"type\":\"state\",\"uuid\":\"" + id + "\",\"deafened\":" + deafened + "}"); }
    private void sendText(String msg) { WebSocket ws = socket; if (ws != null && !ws.isOutputClosed()) ws.sendText(msg, true); }
        private static String escape(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
