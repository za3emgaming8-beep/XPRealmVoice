package me.xprealm.voice;

import de.maxhenkel.voicechat.api.BukkitVoicechatService;
import org.bukkit.Bukkit;
import org.bukkit.plugin.java.JavaPlugin;

public final class XPRealmVoicePlugin extends JavaPlugin {
    private VoiceBridge bridge;
    private VoiceManager voiceManager;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        this.bridge = new VoiceBridge(this);
        this.voiceManager = new VoiceManager(this, bridge);
        this.bridge.setManager(this.voiceManager);

        getCommand("vc").setExecutor(new VoiceCommand(this, voiceManager));
        getCommand("vc").setTabCompleter((sender, command, alias, args) -> java.util.List.of());

        BukkitVoicechatService service = getServer().getServicesManager().load(BukkitVoicechatService.class);
        if (service == null) {
            getLogger().severe("Simple Voice Chat API is not available. Is voicechat installed?");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        service.registerPlugin(new SvcIntegration(this, voiceManager, bridge));
        bridge.start();
        getServer().getPluginManager().registerEvents(new VoicePlayerListener(voiceManager), this);
        getLogger().info("XPRealmVoice enabled.");
    }

    @Override
    public void onDisable() {
        if (voiceManager != null) voiceManager.shutdown();
        if (bridge != null) bridge.stop();
    }
}
