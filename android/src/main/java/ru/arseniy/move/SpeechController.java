package ru.arseniy.move;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Foreground-only, explicitly started Russian counter speech. No microphone or recordings. */
final class SpeechController {
    static final long MAX_PENDING_AGE_MS = 2000, INIT_TIMEOUT_MS = 8000;
    static final String VOICE_TEST_TEXT = "Проверка голоса. Один, два, три.";
    private static final String MISSING_VOICE = "Нужен установленный русский голос Android для работы без интернета. Открой настройки голоса, выбери русский язык и загрузи его, затем проверь звук.";
    private static final String ENGINE_ERROR = "Не удалось включить голосовой счёт. Проверь русский голос и громкость мультимедиа в настройках телефона, затем нажми «Проверить голос».";

    interface Feedback {
        boolean trusted();
        void status(Status value);
    }
    interface Scheduler {
        long now();
        void post(Runnable task);
        void later(Runnable task, long delay);
        void cancel(Runnable task);
    }
    interface InitCallback { void complete(boolean success); }
    interface ErrorCallback { void error(String utteranceId); }
    interface Engine {
        boolean configureRussian();
        boolean speak(String text, String utteranceId);
        void stop();
        void shutdown();
    }
    interface Factory { Engine create(InitCallback init, ErrorCallback error); }

    static final class Status {
        final String state, message;
        final boolean available;
        Status(String state, String message) { this.state = state; this.message = message; available = "ready".equals(state); }
    }

    private final Scheduler scheduler;
    private final Factory factory;
    private final Feedback feedback;
    private Engine engine;
    private boolean initializing, active, destroyed;
    private int generation, utteranceSequence;
    private String pendingText, currentUtterance;
    private long pendingAt;
    private Runnable initTimeout;
    private volatile Status status = new Status("idle", "Голосовой счёт включается при начале тренировки или проверке звука.");

    SpeechController(Context context, Feedback feedback) {
        this(new MainScheduler(), (init, error) -> new AndroidEngine(context.getApplicationContext(), init, error), feedback);
    }
    // Dependency boundary lets JVM tests exercise real cancellation/queue policy,
    // without pretending to have exercised an Android engine or its audible output.
    SpeechController(Scheduler scheduler, Factory factory, Feedback feedback) {
        this.scheduler = scheduler; this.factory = factory; this.feedback = feedback;
    }
    Status status() { return status; }

    void prepare() {
        if (destroyed || !feedback.trusted()) return;
        active = true;
        if (engine != null && status.available) { publish("ready", "Голосовой счёт готов. Громкость регулируется как мультимедиа."); return; }
        if (!initializing) initialize();
    }
    void speak(String text) {
        String normalized = normalize(text);
        if (destroyed || !feedback.trusted() || normalized == null) return;
        active = true;
        if (engine != null && status.available) { speakNow(normalized); return; }
        // Do not start an engine on every repetition if the offline voice is absent.
        // Only an explicit prepare/test action retries that failure.
        if ("unavailable".equals(status.state)) { feedback.status(status); return; }
        pendingText = normalized;
        pendingAt = scheduler.now();
        if (!initializing) initialize();
    }
    static String normalize(String text) {
        if (text == null || text.length() > 120) return null;
        String value = text.trim();
        if (value.isEmpty() || !value.matches("[А-Яа-яЁё0-9 .,!?—–:;\\-]+")) return null;
        return value;
    }

    private void initialize() {
        final int token = ++generation;
        initializing = true;
        publish("initializing", "Подключаю русский голос…");
        initTimeout = () -> {
            if (!destroyed && initializing && token == generation) fail(ENGINE_ERROR);
        };
        scheduler.later(initTimeout, INIT_TIMEOUT_MS);
        try {
            // Always post the callback: some engines report failure during construction.
            engine = factory.create(success -> scheduler.post(() -> initialized(token, success)),
                id -> scheduler.post(() -> speechError(id)));
            if (engine == null) fail(ENGINE_ERROR);
        } catch (RuntimeException unavailable) { fail(ENGINE_ERROR); }
    }
    private void initialized(int token, boolean success) {
        if (destroyed || token != generation || !initializing) return;
        cancelTimeout();
        if (!active || !feedback.trusted()) { stop(); return; }
        initializing = false;
        if (!success) { fail(ENGINE_ERROR); return; }
        try {
            if (engine == null || !engine.configureRussian()) { fail(MISSING_VOICE); return; }
        } catch (RuntimeException unavailable) { fail(ENGINE_ERROR); return; }
        publish("ready", "Голосовой счёт готов. Громкость регулируется как мультимедиа.");
        String latest = pendingText;
        long age = scheduler.now() - pendingAt;
        pendingText = null;
        // A deliberate voice check should still be audible after a cold start.
        // Only this exact test phrase may wait for the existing init timeout;
        // real workout numbers remain stale after two seconds.
        long maxAge = VOICE_TEST_TEXT.equals(latest) ? INIT_TIMEOUT_MS : MAX_PENDING_AGE_MS;
        if (latest != null && age >= 0 && age <= maxAge) speakNow(latest);
    }
    private void speakNow(String text) {
        if (destroyed || !active || !feedback.trusted() || engine == null || !status.available) return;
        currentUtterance = "move-counter-" + generation + "-" + (++utteranceSequence);
        try { if (!engine.speak(text, currentUtterance)) fail(ENGINE_ERROR); }
        catch (RuntimeException unavailable) { fail(ENGINE_ERROR); }
    }
    private void speechError(String id) {
        // Ignore errors from a flushed older number or an earlier/stopped workout.
        if (!destroyed && active && feedback.trusted() && id != null && id.equals(currentUtterance)) fail(ENGINE_ERROR);
    }
    private void publish(String state, String message) {
        status = new Status(state, message);
        if (!destroyed && feedback.trusted()) feedback.status(status);
    }
    private void cancelTimeout() {
        if (initTimeout != null) { scheduler.cancel(initTimeout); initTimeout = null; }
    }
    private void releaseEngine() {
        Engine previous = engine; engine = null;
        if (previous != null) {
            try { previous.stop(); } catch (RuntimeException ignored) { }
            try { previous.shutdown(); } catch (RuntimeException ignored) { }
        }
    }
    private void fail(String message) {
        generation++;
        active = false; initializing = false; pendingText = null; currentUtterance = null;
        cancelTimeout(); releaseEngine(); publish("unavailable", message);
    }
    void stop() {
        generation++;
        active = false; pendingText = null; currentUtterance = null;
        cancelTimeout();
        if (initializing) {
            initializing = false;
            releaseEngine();
            status = new Status("idle", "Голосовой счёт остановлен.");
        } else if (engine != null) {
            try { engine.stop(); } catch (RuntimeException ignored) { }
        }
    }
    // Re-read locally installed voices only after the user returns and explicitly retries.
    void resetForSettings() {
        stop(); releaseEngine();
        status = new Status("idle", "После выбора русского голоса нажми «Проверить голос».");
    }
    void destroy() {
        stop(); destroyed = true; releaseEngine();
    }

    static boolean eligibleVoice(Locale locale, boolean requiresNetwork, Set<String> features) {
        return locale != null && "ru".equals(locale.getLanguage()) && !requiresNetwork
            && features != null && !features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED);
    }

    private static final class MainScheduler implements Scheduler {
        private final Handler handler = new Handler(Looper.getMainLooper());
        @Override public long now() { return SystemClock.uptimeMillis(); }
        @Override public void post(Runnable task) { handler.post(task); }
        @Override public void later(Runnable task, long delay) { handler.postDelayed(task, delay); }
        @Override public void cancel(Runnable task) { handler.removeCallbacks(task); }
    }
    private static final class AndroidEngine implements Engine {
        private final TextToSpeech tts;
        AndroidEngine(Context context, InitCallback init, ErrorCallback error) {
            tts = new TextToSpeech(context, code -> init.complete(code == TextToSpeech.SUCCESS));
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { }
                @Override public void onError(String id) { error.error(id); }
                @Override public void onError(String id, int code) { error.error(id); }
            });
        }
        @Override public boolean configureRussian() {
            Set<Voice> voices = tts.getVoices();
            if (voices == null) return false;
            List<Voice> local = new ArrayList<>();
            for (Voice voice : voices) if (voice != null && eligibleVoice(voice.getLocale(), voice.isNetworkConnectionRequired(), voice.getFeatures())) local.add(voice);
            local.sort(Comparator.comparingInt((Voice voice) -> "RU".equals(voice.getLocale().getCountry()) ? 0 : 1)
                .thenComparingInt(Voice::getLatency).thenComparing(Voice::getName));
            for (Voice voice : local) {
                if (tts.isLanguageAvailable(voice.getLocale()) < TextToSpeech.LANG_AVAILABLE) continue;
                // Never call setLanguage or select a notInstalled/network voice: both
                // could cause a download or a fallback outside the requested mode.
                if (tts.setVoice(voice) != TextToSpeech.SUCCESS) continue;
                Voice selected = tts.getVoice();
                if (selected == null || !voice.getName().equals(selected.getName())
                    || !eligibleVoice(selected.getLocale(), selected.isNetworkConnectionRequired(), selected.getFeatures())) continue;
                AudioAttributes attributes = new AudioAttributes.Builder().setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .setUsage(AudioAttributes.USAGE_ASSISTANT).build();
                if (tts.setAudioAttributes(attributes) != TextToSpeech.SUCCESS) return false;
                tts.setSpeechRate(1.05f);
                tts.setPitch(1f);
                return true;
            }
            return false;
        }
        @Override public boolean speak(String text, String utteranceId) {
            Bundle parameters = new Bundle();
            parameters.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
            // Flush interrupts this client's old utterance: never recite a stale queue.
            return tts.speak(text, TextToSpeech.QUEUE_FLUSH, parameters, utteranceId) == TextToSpeech.SUCCESS;
        }
        @Override public void stop() { tts.stop(); }
        @Override public void shutdown() { tts.shutdown(); }
    }
}
