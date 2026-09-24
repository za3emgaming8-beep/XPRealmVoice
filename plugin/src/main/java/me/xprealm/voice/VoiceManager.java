package me.xprealm.voice;

import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.audiochannel.LocationalAudioChannel;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.geysermc.cumulus.form.SimpleForm;
import org.geysermc.floodgate.api.FloodgateApi;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class VoiceManager {
    private final XPRealmVoicePlugin plugin;
    private final VoiceBridge bridge;
    private final Map<UUID, VoiceSession> sessions = new ConcurrentHashMap<>();
    private volatile VoicechatServerApi svc;
    private int locationTask = -1;

    public VoiceManager(XPRealmVoicePlugin plugin, VoiceBridge bridge) {
        this.plugin = plugin;
        this.bridge = bridge;
        this.locationTask = Bukkit.getScheduler().runTaskTimer(plugin, this::updateLocations, 1L, 2L).getTaskId();
    }

    public void setSvc(VoicechatServerApi svc) { this.svc = svc; }
    public VoicechatServerApi getSvc() { return svc; }
    public Map<UUID, VoiceSession> getSessions() { return sessions; }

    private void updateLocations() {
        if (svc == null) return;
        for (VoiceSession s : sessions.values()) {
            Player p = Bukkit.getPlayer(s.playerId);
            LocationalAudioChannel channel = s.bedrockToJavaChannel;
            if (p == null || channel == null || channel.isClosed()) continue;
            channel.updateLocation(svc.createPosition(p.getX(), p.getY(), p.getZ()));
        }
    }

    public void openMenu(Player player) {
        if (!isBedrock(player)) {
            player.sendMessage("§b§lXPRealm Voice §7» §fJava players use normal Simple Voice Chat (V).");
            player.sendMessage("§7Bedrock players use §n/vc§r§7 to join the web bridge.");
            return;
        }
        VoiceSession session = sessions.get(player.getUniqueId());
        boolean active = session != null;
        String mic = active && !session.muted ? "§a🎤 Microphone: ON" : "§c🎤 Microphone: OFF";
        String deaf = active && !session.deafened ? "§a🔊 Hearing: ON" : "§c🔇 Hearing: OFF";

        SimpleForm.Builder form = SimpleForm.builder()
                .title("§bXPRealm Voice")
                .content(mic + "\n" + deaf + "\n\n§7Java players use normal Simple Voice Chat.")
                .button(active ? "§e🌐 Re-open Voice" : "§b🌐 Join Voice")
                .button(active && !session.muted ? "§c🎤 Mute" : "§a🎤 Unmute")
                .button(active && !session.deafened ? "§c🔇 Deafen" : "§a🔊 Undeafen")
                .button("§c■ Stop Voice")
                .validResultHandler(response -> {
                    switch (response.clickedButtonId()) {
                        case 0 -> enable(player);
                        case 1 -> toggleMute(player);
                        case 2 -> toggleDeafen(player);
                        case 3 -> stopVoice(player.getUniqueId());
                    }
                });
        FloodgateApi.getInstance().sendForm(player.getUniqueId(), form);
    }

    public void enable(Player player) {
        if (!isBedrock(player)) return;
        if (svc == null) {
            player.sendMessage("§cVoice API isn't ready yet.");
            return;
        }
        UUID id = player.getUniqueId();
        VoiceSession session = sessions.computeIfAbsent(id, u -> new VoiceSession(u, UUID.randomUUID().toString().replace("-", "")));

        if (session.bedrockToJavaChannel == null || session.bedrockToJavaChannel.isClosed()) {
            session.bedrockToJavaChannel = svc.createLocationalAudioChannel(
                    UUID.randomUUID(),
                    svc.fromServerLevel(player.getWorld()),
                    svc.createPosition(player.getX(), player.getY(), player.getZ())
            );
            if (session.bedrockToJavaChannel == null) {
                player.sendMessage("§cCould not create the SVC audio channel.");
                return;
            }
            double distance = plugin.getConfig().getBoolean("bridge.follow-svc-distance", true)
                    ? svc.getVoiceChatDistance()
                    : plugin.getConfig().getDouble("bridge.fallback-distance", 48.0);
            session.bedrockToJavaChannel.setDistance((float) distance);
            session.encoder = svc.createEncoder();
        }

        bridge.registerSession(session, player.getName());
        player.sendMessage("§b§lXPRealm Voice §7» §fUse the button below to join:");
        String url = plugin.getConfig().getString("web.public-url", "https://voice.xprealm.minecraft.how") + "/?token=" + session.token;
        player.sendMessage("§n§b" + url);
    }

    public void toggleMute(Player player) {
        VoiceSession s = sessions.get(player.getUniqueId());
        if (s == null) { enable(player); return; }
        s.muted = !s.muted;
        bridge.setMuted(s.playerId, s.muted);
        openMenu(player);
    }

    public void toggleDeafen(Player player) {
        VoiceSession s = sessions.get(player.getUniqueId());
        if (s == null) { enable(player); return; }
        s.deafened = !s.deafened;
        bridge.setDeafened(s.playerId, s.deafened);
        openMenu(player);
    }

    public boolean isBedrock(Player player) {
        try { return FloodgateApi.getInstance().isFloodgatePlayer(player.getUniqueId()); }
        catch (Throwable ignored) { return false; }
    }

    public void stopVoice(UUID id) {
        VoiceSession s = sessions.remove(id);
        if (s == null) return;
        if (s.bedrockToJavaChannel != null) s.bedrockToJavaChannel.flush();
        if (s.encoder != null) s.encoder.close();
        bridge.closeSession(id);
    }

    public VoiceSession session(UUID id) { return sessions.get(id); }

    public void shutdown() {
        if (locationTask != -1) Bukkit.getScheduler().cancelTask(locationTask);
        for (UUID id : sessions.keySet()) stopVoice(id);
    }
}
