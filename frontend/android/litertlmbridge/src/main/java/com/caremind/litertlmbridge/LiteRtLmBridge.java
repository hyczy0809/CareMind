package com.caremind.litertlmbridge;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.Locale;
import java.util.Map;

/**
 * Reflection boundary around LiteRT-LM.
 *
 * The React Native / Expo app still compiles Kotlin 1.9.x sources. LiteRT-LM
 * 0.13.x is published with Kotlin 2.2.x metadata and Java 21 bytecode, so
 * exposing it to app Kotlin breaks compilation. This Java-only module keeps the
 * compile-time API plain Java and loads LiteRT-LM at runtime after Gradle has
 * packaged the dependency into the APK.
 */
public final class LiteRtLmBridge implements AutoCloseable {
    private static final Map<String, Object> EMPTY_CONTEXT = Collections.emptyMap();
    private static final String PKG = "com.google.ai.edge.litertlm.";

    private final Object engine;
    private final String backendName;

    private LiteRtLmBridge(Object engine, String backendName) {
        this.engine = engine;
        this.backendName = backendName;
    }

    public static LiteRtLmBridge create(
            String modelPath,
            String backendName,
            String cacheDir,
            int maxTokens
    ) {
        String normalizedBackend = normalizeBackendName(backendName);
        try {
            Class<?> backendClass = cls("Backend");
            Object backend = backendForName(normalizedBackend);

            Class<?> engineConfigClass = cls("EngineConfig");
            Constructor<?> engineConfigCtor = engineConfigClass.getConstructor(
                    String.class,
                    backendClass,
                    backendClass,
                    backendClass,
                    Integer.class,
                    Integer.class,
                    String.class
            );
            Object config = engineConfigCtor.newInstance(
                    modelPath,
                    backend,
                    null,
                    null,
                    Integer.valueOf(maxTokens),
                    null,
                    cacheDir
            );

            Class<?> engineClass = cls("Engine");
            Object engine = engineClass.getConstructor(engineConfigClass).newInstance(config);
            engineClass.getMethod("initialize").invoke(engine);
            return new LiteRtLmBridge(engine, normalizedBackend);
        } catch (ReflectiveOperationException error) {
            throw asRuntime("LiteRT-LM engine initialization", error);
        }
    }

    public String backendName() {
        return backendName;
    }

    public String generate(
            String prompt,
            int topK,
            double topP,
            double temperature
    ) {
        try {
            Class<?> samplerConfigClass = cls("SamplerConfig");
            Object samplerConfig = samplerConfigClass
                    .getConstructor(int.class, double.class, double.class, int.class)
                    .newInstance(topK, topP, temperature, 0);

            Class<?> contentsClass = cls("Contents");
            Class<?> conversationConfigClass = cls("ConversationConfig");
            Object conversationConfig = conversationConfigClass
                    .getConstructor(contentsClass, java.util.List.class, java.util.List.class, samplerConfigClass)
                    .newInstance(null, Collections.emptyList(), Collections.emptyList(), samplerConfig);

            Object conversation = engine
                    .getClass()
                    .getMethod("createConversation", conversationConfigClass)
                    .invoke(engine, conversationConfig);
            try {
                Class<?> messageClass = cls("Message");
                Object response = conversation
                        .getClass()
                        .getMethod("sendMessage", String.class, Map.class)
                        .invoke(conversation, prompt, EMPTY_CONTEXT);
                Object rendered = conversation
                        .getClass()
                        .getMethod("renderMessageIntoString", messageClass, Map.class)
                        .invoke(conversation, response, EMPTY_CONTEXT);
                return rendered == null ? "" : rendered.toString();
            } finally {
                closeObject(conversation);
            }
        } catch (ReflectiveOperationException error) {
            throw asRuntime("LiteRT-LM generation", error);
        }
    }

    @Override
    public void close() {
        try {
            closeObject(engine);
        } catch (ReflectiveOperationException error) {
            throw asRuntime("LiteRT-LM close", error);
        }
    }

    private static Object backendForName(String backendName) throws ReflectiveOperationException {
        if ("CPU".equals(backendName)) {
            return cls("Backend$CPU").getConstructor().newInstance();
        }
        return cls("Backend$GPU").getConstructor().newInstance();
    }

    private static Class<?> cls(String simpleName) throws ClassNotFoundException {
        return Class.forName(PKG + simpleName);
    }

    private static void closeObject(Object closeable) throws ReflectiveOperationException {
        if (closeable == null) {
            return;
        }
        if (closeable instanceof AutoCloseable) {
            try {
                ((AutoCloseable) closeable).close();
                return;
            } catch (Exception error) {
                throw new InvocationTargetException(error);
            }
        }
        Method close = closeable.getClass().getMethod("close");
        close.invoke(closeable);
    }

    private static String normalizeBackendName(String backendName) {
        if (backendName == null) {
            return "GPU";
        }
        String normalized = backendName.trim().toUpperCase(Locale.US);
        return "CPU".equals(normalized) ? "CPU" : "GPU";
    }

    private static RuntimeException asRuntime(String action, Throwable error) {
        Throwable cause = unwrap(error);
        if (cause instanceof RuntimeException) {
            return (RuntimeException) cause;
        }
        if (cause instanceof Error) {
            throw (Error) cause;
        }
        String message = cause.getMessage();
        return new IllegalStateException(action + " failed" + (message == null ? "" : ": " + message), cause);
    }

    private static Throwable unwrap(Throwable error) {
        Throwable current = error;
        while (current instanceof InvocationTargetException &&
                ((InvocationTargetException) current).getTargetException() != null) {
            current = ((InvocationTargetException) current).getTargetException();
        }
        return current;
    }
}
