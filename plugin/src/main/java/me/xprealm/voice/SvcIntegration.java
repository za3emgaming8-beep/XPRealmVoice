package me.xprealm.voice;

import de.maxhenkel.voicechat.api.VoicechatApi;
import de.maxhenkel.voicechat.api.VoicechatConnection;
import de.maxhenkel.voicechat.api.VoicechatPlugin;
import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.events.EventRegistration;
import de.maxhenkel.voicechat.api.events.MicrophonePacketEvent;
import de.maxhenkel.voicechat.api.events.VoicechatServerStartedEvent;

public final class SvcIntegration implements VoicechatPlugin {
    private final XPRealmVoicePlugin plugin;
    private final VoiceManager manager;
    private final VoiceBridge bridge;

    public SvcIntegration(XPRealmVoicePlugin plugin, VoiceManager manager, VoiceBridge bridge) {
        this.plugin = plugin; this.manager = manager; this.bridge = bridge;
    }

    @Override public String getPluginId() { return "xprealmvoice"; }

    @Override
    public void initialize(VoicechatApi api) {
        if (api instanceof VoicechatServerApi serverApi) {
            manager.setSvc(serverApi);
            bridge.setSvc(serverApi);
            plugin.getLogger().info("Connected to Simple Voice Chat API.");
        }
    }

    @Override
    public void registerEvents(EventRegistration registration) {
        registration.registerEvent(VoicechatServerStartedEvent.class, event -> manager.setSvc(event.getVoicechat()));
        registration.registerEvent(MicrophonePacketEvent.class, bridge::onJavaMicrophonePacket);
    }
}
