# LiteRT-LM is loaded through reflection from LiteRtLmBridge so the app can keep
# compiling with the Expo/RN Kotlin toolchain. Preserve runtime class names and
# methods if app release minification is enabled later.
-keep class com.google.ai.edge.litertlm.** { *; }
-keep class com.caremind.litertlmbridge.LiteRtLmBridge { *; }
