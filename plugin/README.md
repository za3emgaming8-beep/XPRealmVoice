# XPRealmVoice plugin

Requires Simple Voice Chat server plugin and Floodgate for Bedrock forms.

The plugin uses the official SVC API's `AudioSender` to inject Bedrock microphone audio as if it came from the Bedrock player's voice connection, and a `PlayerAudioListener` to capture what the Bedrock player would hear. The current API documents both facilities. Build against Java 25.
