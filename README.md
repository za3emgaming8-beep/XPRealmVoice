# XPRealmVoice

Cross-platform voice bridge for XPRealm:
- Java players: normal Simple Voice Chat client/mod.
- Bedrock players: `/vc` -> Floodgate form -> web voice page.
- Paper plugin bridges Bedrock microphone audio into Simple Voice Chat with `AudioSender`.
- Paper plugin mirrors the audio a Bedrock player would receive with `PlayerAudioListener` to the web client.

## Important
This is an MVP/prototype. It uses PCM over WebSocket between browser and bridge for simplicity, while Simple Voice Chat remains Opus internally. For a production deployment, add TLS (`wss://`), authentication hardening, rate limits, and preferably browser-side Opus/WebRTC to reduce bandwidth.

## Requirements
- Paper 26.2 + Java 25
- Simple Voice Chat plugin on the Paper server
- Simple Voice Chat client/mod for Java players
- Geyser + Floodgate for Bedrock players
- Node.js 20+ for the web bridge

## Build plugin
Use Java 25 and Gradle on your panel/local machine:
`gradle build` (use a Java 25 environment)

The jar will be in `plugin/build/libs/`.

## Run web bridge
`cd web`
`npm install`
`node server.js`

The web bridge defaults to port 8080. Put it behind HTTPS in production because microphone access requires a secure context except for localhost.

## Config
Edit `plugin/src/main/resources/config.yml` before building or copy/edit the generated config in the server's `plugins/XPRealmVoice/config.yml`.
