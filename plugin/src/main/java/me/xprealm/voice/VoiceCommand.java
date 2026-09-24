package me.xprealm.voice;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

public final class VoiceCommand implements CommandExecutor {
    private final XPRealmVoicePlugin plugin;
    private final VoiceManager manager;

    public VoiceCommand(XPRealmVoicePlugin plugin, VoiceManager manager) {
        this.plugin = plugin;
        this.manager = manager;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) return true;
        if (!player.hasPermission("xprealmvoice.use")) {
            player.sendMessage("§cYou don't have permission to use XPRealm Voice.");
            return true;
        }
        manager.openMenu(player);
        return true;
    }
}
