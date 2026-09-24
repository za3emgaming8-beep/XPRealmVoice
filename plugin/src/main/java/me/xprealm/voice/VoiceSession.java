package me.xprealm.voice;

import de.maxhenkel.voicechat.api.audiochannel.LocationalAudioChannel;
import de.maxhenkel.voicechat.api.opus.OpusEncoder;

import java.util.UUID;

public final class VoiceSession {
    public final UUID playerId;
    public final String token;
    public volatile boolean muted;
    public volatile boolean deafened;
    public volatile LocationalAudioChannel bedrockToJavaChannel;
    public volatile OpusEncoder encoder;

    public VoiceSession(UUID playerId, String token) {
        this.playerId = playerId;
        this.token = token;
    }
}
