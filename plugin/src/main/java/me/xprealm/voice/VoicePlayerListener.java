package me.xprealm.voice;

import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;

public final class VoicePlayerListener implements Listener {
    private final VoiceManager manager;

    public VoicePlayerListener(VoiceManager manager) {
        this.manager = manager;
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        manager.stopVoice(event.getPlayer().getUniqueId());
    }
}
