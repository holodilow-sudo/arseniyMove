package ru.arseniy.move;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.FilterInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/** Local training shell with an isolated release downloader. Camera frames are handled by the packaged web app. */
public final class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/assets/app/index.html";
    private static final int CAMERA_REQUEST = 3101, NOTIFICATION_REQUEST = 3102, STARTUP_REQUEST = 3103;
    private static final String PERMISSIONS_PREFS = "move-permissions-v2";
    private static final int PAPER = Color.rgb(16, 24, 35);
    private WebView webView;
    private ResultShareController shareController;
    private UpdateController updateController;
    private volatile SpeechController speechController;
    private final AtomicLong speechRequestEpoch = new AtomicLong();
    private PermissionRequest pendingCamera;
    private volatile boolean cameraPermissionInFlight, notificationPermissionInFlight;
    private volatile int runtimePermissionRequest;
    private String pendingCameraBridgeId, cameraBridgeOutcome;
    private boolean cameraRequestDeferred;
    private boolean destroyed;
    private volatile boolean foreground;
    private boolean mediaPausedForBackground;
    private String pendingReminderId;
    private volatile boolean documentReady;
    private AlertDialog exitDialog;
    private volatile AlertDialog permissionOfferDialog;
    private final StartupPermissionFlow startupPermissions = new StartupPermissionFlow();
    private String appVersion = "", webViewVersion = "";
    private final Map<String, Long> videoLengths = new ConcurrentHashMap<>();

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(PAPER);
        configureInsets(container);
        setContentView(container);
        webView = new WebView(this);
        webView.setBackgroundColor(PAPER);
        container.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        // Capture still requires an explicit workout action and CAMERA consent.
        // Its muted preview starts AFTER asynchronous permissions/getUserMedia;
        // requiring a still-active gesture here rejects playback on some WebViews.
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setTextZoom(100);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        shareController = new ResultShareController(this, new ResultShareController.Feedback() {
            @Override public boolean trusted() { return foreground && isTrustedDocument(); }
            @Override public void result(String requestId, String status) {
                evaluate("if(window.MoveApp&&typeof MoveApp.nativeShareResult==='function'){MoveApp.nativeShareResult("
                    + JSONObject.quote(requestId) + "," + JSONObject.quote(status)
                    + ");}else if(window.CityShare&&typeof CityShare.nativeResult==='function'){CityShare.nativeResult("
                    + JSONObject.quote(requestId) + "," + JSONObject.quote(status) + ");}");
            }
        });
        // Construct the controller without starting the system TTS service.
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        speechController = new SpeechController(this, new SpeechController.Feedback() {
            @Override public boolean trusted() { return foreground && isTrustedDocument(); }
            @Override public void status(SpeechController.Status value) { notifySpeechStatus(value); }
        });
        updateController = new UpdateController(this, new UpdateController.Feedback() {
            @Override public boolean canInstall() { return foreground && isTrustedDocument() && runtimePermissionRequest == 0 && permissionOfferDialog == null; }
            @Override public void status(String json) { evaluate("if(window.MoveApp&&MoveApp.nativeUpdateStatus)MoveApp.nativeUpdateStatus(" + json + ");"); }
        });
        webView.addJavascriptInterface(new NativeBridge(), "MoveNative");
        webView.addJavascriptInterface(new ShareBridge(), "AndroidShare");
        webView.setWebViewClient(new LocalClient());
        webView.setWebChromeClient(new CameraChromeClient());
        try { appVersion = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (PackageManager.NameNotFoundException ignored) { }
        PackageInfo webViewPackage = WebView.getCurrentWebViewPackage();
        if (webViewPackage != null) webViewVersion = webViewPackage.versionName;
        webView.loadUrl(START_URL);
        ReminderScheduler.ensureChannel(this);
        ReminderScheduler.initializeMorningReminder(this);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher()
            .registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
    }

    @SuppressWarnings("deprecation")
    private void configureInsets(FrameLayout container) {
        getWindow().setStatusBarColor(PAPER);
        getWindow().setNavigationBarColor(PAPER);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            getWindow().getDecorView().setOnApplyWindowInsetsListener((view, insets) -> {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                container.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return insets;
            });
        }
    }

    private static boolean trustedOrigin(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && uri.getPort() == -1 && uri.getUserInfo() == null;
    }

    private static boolean localAsset(Uri uri) {
        if (!trustedOrigin(uri) || uri.getQuery() != null) return false;
        return LocalAssetPath.resolve(uri.getPath()) != null;
    }

    static final class LocalAssetPath {
        /** AssetManager looks up exact APK ZIP entry names, not filesystem paths. */
        static String resolve(String path) {
            if (path == null || !path.startsWith("/assets/app/") || !path.matches("/[A-Za-z0-9_./-]+")) return null;
            // Validate BEFORE normalization: never turn traversal into an allowed asset.
            for (String part : path.split("/")) if ("..".equals(part) || ".".equals(part)) return null;
            // MediaPipe historically produced wasm//file.js when its base ended in /.
            // Filesystems hid that error in preview, but APK ZIP entry names did not.
            return path.substring("/assets/".length()).replaceAll("/{2,}", "/");
        }
    }

    private boolean isTrustedDocument() {
        if (destroyed || isFinishing() || webView == null || !documentReady || webView.getUrl() == null) return false;
        Uri uri = Uri.parse(webView.getUrl());
        return localAsset(uri) && "/assets/app/index.html".equals(uri.getPath());
    }

    private void evaluate(String js) {
        if (isTrustedDocument()) webView.evaluateJavascript(js, null);
    }

    public final class NativeBridge {
        @JavascriptInterface public String getUpdateStatus() {
            return documentReady && updateController != null ? updateController.status() : "{}";
        }
        @JavascriptInterface public void setUpdateAllowed(boolean allowed) {
            runOnUiThread(() -> { if (isTrustedDocument() && updateController != null) updateController.allow(allowed && foreground); });
        }
        @JavascriptInterface public void checkForUpdates() {
            runOnUiThread(() -> { if (foreground && isTrustedDocument() && updateController != null) updateController.check(true); });
        }
        @JavascriptInterface public void installUpdate() {
            runOnUiThread(() -> { if (foreground && isTrustedDocument() && updateController != null) updateController.install(); });
        }

        @JavascriptInterface public String getCapabilities() {
            // This method runs on WebView's bridge thread: never call WebView.getUrl here.
            if (!documentReady) return "{\"available\":false}";
            JSONObject result = ReminderScheduler.capabilities(MainActivity.this);
            try {
                result.put("nativeCameraPermission", true).put("cameraPermissionState", cameraPermissionState())
                    .put("permissionPromptActive", runtimePermissionRequest != 0 || startupPermissions.active || permissionOfferDialog != null)
                    .put("openAppSettings", true).put("appVersion", appVersion)
                    .put("androidVersion", Build.VERSION.RELEASE).put("androidApi", Build.VERSION.SDK_INT)
                    .put("manufacturer", Build.MANUFACTURER).put("model", Build.MODEL)
                    .put("webViewVersion", webViewVersion);
                SpeechController controller = speechController;
                SpeechController.Status speech = controller == null ? null : controller.status();
                result.put("nativeSpeech", true).put("speechAvailable", speech != null && speech.available)
                    .put("speechState", speech == null ? "idle" : speech.state)
                    .put("speechMessage", speech == null ? "" : speech.message)
                    .put("openSpeechSettings", true);
            } catch (org.json.JSONException ignored) { }
            return result.toString();
        }
        @JavascriptInterface public void prepareCounterSpeech() {
            if (!foreground || !documentReady) return;
            final long epoch = speechRequestEpoch.get();
            runOnUiThread(() -> { if (epoch == speechRequestEpoch.get() && foreground && isTrustedDocument() && speechController != null) speechController.prepare(); });
        }
        @JavascriptInterface public void speakCounter(String text) {
            if (!foreground || !documentReady || SpeechController.normalize(text) == null) return;
            final long epoch = speechRequestEpoch.get();
            runOnUiThread(() -> { if (epoch == speechRequestEpoch.get() && foreground && isTrustedDocument() && speechController != null) speechController.speak(text); });
        }
        @JavascriptInterface public void stopCounterSpeech() {
            speechRequestEpoch.incrementAndGet();
            runOnUiThread(() -> { if (isTrustedDocument() && speechController != null) speechController.stop(); });
        }
        @JavascriptInterface public void openSpeechSettings() {
            runOnUiThread(() -> {
                if (!foreground || runtimePermissionRequest != 0 || !isTrustedDocument()) return;
                speechRequestEpoch.incrementAndGet();
                if (speechController != null) speechController.resetForSettings();
                // Explicit button only. AOSP exposes this settings activity; OEMs
                // may omit it, so fall back to Android's public accessibility page.
                try { startActivity(new Intent("com.android.settings.TTS_SETTINGS").setPackage("com.android.settings")); }
                catch (RuntimeException absent) {
                    try { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
                    catch (RuntimeException unavailable) { Toast.makeText(MainActivity.this,
                        "Открой настройки телефона → Специальные возможности → Синтез речи. Выбери русский голос.", Toast.LENGTH_LONG).show(); }
                }
            });
        }
        @JavascriptInterface public void scheduleReminder(String json) {
            if (json == null || json.length() > 2048) return;
            runOnUiThread(() -> { if (foreground && isTrustedDocument()) configureReminder(json); });
        }
        @JavascriptInterface public void requestCameraPermission(String requestId) {
            if (requestId == null || !requestId.matches("[A-Za-z0-9_-]{1,80}")) return;
            runOnUiThread(() -> {
                if (!isTrustedDocument()) return;
                if (!foreground && runtimePermissionRequest == 0) { cameraPermissionResult(requestId, "cancelled"); return; }
                if (pendingCameraBridgeId != null) {
                    if (!pendingCameraBridgeId.equals(requestId)) cameraPermissionResult(requestId, "busy");
                    return;
                }
                pendingCameraBridgeId = requestId;
                cameraBridgeOutcome = null;
                // Join the one startup/system dialog instead of starting a second request.
                if (runtimePermissionRequest == 0 && !startupPermissions.active && permissionOfferDialog == null) requestCameraAccess();
                else cameraRequestDeferred = !cameraPermissionInFlight && !cameraGranted();
            });
        }
        @JavascriptInterface public void openAppSettings() {
            runOnUiThread(() -> {
                if (!foreground || runtimePermissionRequest != 0 || !isTrustedDocument()) return;
                openPermissionSettings();
            });
        }
    }

    private void notifySpeechStatus(SpeechController.Status value) {
        if (!foreground || !isTrustedDocument()) return;
        JSONObject status = new JSONObject();
        try {
            status.put("state", value.state).put("available", value.available).put("message", value.message)
                .put("offline", value.available).put("language", "ru-RU");
        } catch (org.json.JSONException ignored) { }
        evaluate("if(window.MoveApp&&typeof MoveApp.nativeSpeechStatus==='function'){MoveApp.nativeSpeechStatus(" + status + ");}");
    }

    private void openPermissionSettings() {
        try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getPackageName(), null))); }
        catch (RuntimeException unavailable) { Toast.makeText(MainActivity.this,
            "Открой настройки телефона → Приложения → Arseniy Move → Разрешения.", Toast.LENGTH_LONG).show(); }
    }

    /** Pure launch-flow policy, also exercised by the JVM regression checks. */
    static final class StartupPermissionFlow {
        static final int DONE = 0, CAMERA = 1, NOTIFICATIONS = 2, SETTINGS = 3;
        private boolean offered, cameraAttempted, notificationsAttempted;
        volatile boolean active;
        boolean offer(boolean cameraMissing, boolean notificationsMissing) {
            if (offered || (!cameraMissing && !notificationsMissing)) return false;
            offered = true;
            return true;
        }
        void begin() { active = true; }
        int next(boolean cameraMissing, boolean cameraBlocked, boolean notificationsMissing,
                 boolean notificationRuntimeMissing, boolean notificationsBlocked) {
            if (!active) return DONE;
            if (cameraMissing && !cameraBlocked && !cameraAttempted) {
                cameraAttempted = true;
                return CAMERA;
            }
            if (notificationRuntimeMissing && !notificationsBlocked && !notificationsAttempted) {
                notificationsAttempted = true;
                return NOTIFICATIONS;
            }
            active = false;
            return (cameraMissing && cameraBlocked) || (notificationsMissing
                && (!notificationRuntimeMissing || notificationsBlocked)) ? SETTINGS : DONE;
        }
    }

    private SharedPreferences permissionPrefs() { return getSharedPreferences(PERMISSIONS_PREFS, MODE_PRIVATE); }
    private boolean cameraGranted() { return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED; }
    private String cameraPermissionState() {
        if (cameraGranted()) return "granted";
        SharedPreferences saved = permissionPrefs();
        if (saved.getBoolean("cameraBlocked", false)) return "settings_required";
        return saved.getBoolean("cameraDenied", false) ? "denied" : "prompt";
    }
    private void rememberPermissionResults(String[] permissions, int[] grants) {
        SharedPreferences.Editor saved = permissionPrefs().edit();
        for (int i = 0; i < Math.min(permissions.length, grants.length); i++) {
            if (Manifest.permission.CAMERA.equals(permissions[i])) {
                boolean granted = cameraGranted();
                saved.putBoolean("cameraDenied", !granted).putBoolean("cameraBlocked",
                    !granted && !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA));
            } else if (Manifest.permission.POST_NOTIFICATIONS.equals(permissions[i]) && Build.VERSION.SDK_INT >= 33) {
                boolean granted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
                saved.putBoolean("notificationsBlocked", !granted && !shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS));
            }
        }
        saved.apply();
    }
    private void launchPermissionDialog(String[] permissions, int code) {
        if (runtimePermissionRequest != 0) throw new IllegalStateException("Permission request already active");
        runtimePermissionRequest = code;
        for (String permission : permissions) {
            if (Manifest.permission.CAMERA.equals(permission)) {
                cameraPermissionInFlight = true;
                cameraRequestDeferred = false;
            }
            if (Manifest.permission.POST_NOTIFICATIONS.equals(permission)) notificationPermissionInFlight = true;
        }
        try { requestPermissions(permissions, code); }
        catch (RuntimeException unavailable) {
            runtimePermissionRequest = 0;
            cameraPermissionInFlight = false;
            notificationPermissionInFlight = false;
            throw unavailable;
        }
    }
    private void requestStartupPermissions() {
        if (!foreground || !isTrustedDocument() || runtimePermissionRequest != 0 || permissionOfferDialog != null) return;
        if (startupPermissions.active) { advanceStartupPermissions(); return; }
        boolean cameraMissing = cameraMissing();
        boolean notificationsMissing = !ReminderScheduler.notificationsAvailable(this);
        // Recheck actual grants on each launch. The old persisted startupRequested
        // flag made a denied/interrupted first attempt suppress this offer forever.
        if (!startupPermissions.offer(cameraMissing, notificationsMissing)) return;
        String camera = !getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
            ? "Камера на устройстве не найдена."
            : cameraMissing ? "Камера — чтобы считать упражнения на телефоне. Видео не сохраняется и не отправляется."
            : "Камера уже разрешена.";
        String notifications = notificationsMissing
            ? "Уведомления — чтобы напоминать о разминке утром, около 07:00."
            : "Уведомления уже включены. Время можно изменить в настройках.";
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Разрешения для тренировок")
            .setMessage(camera + "\n\n" + notifications + "\n\nНажми «Продолжить», затем разреши доступ в окнах Android.")
            .setNegativeButton("Позже", null)
            .setPositiveButton("Продолжить", (ignored, which) -> {
                startupPermissions.begin();
                // Wait until this explanation is dismissed before the system dialog.
                webView.post(this::advanceStartupPermissions);
            }).create();
        permissionOfferDialog = dialog;
        dialog.setOnDismissListener(ignored -> {
            if (permissionOfferDialog == dialog) permissionOfferDialog = null;
            if (!startupPermissions.active) completeCameraAccess();
        });
        dialog.show();
    }
    private boolean cameraMissing() {
        return getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) && !cameraGranted();
    }
    private void advanceStartupPermissions() {
        if (!foreground || !isTrustedDocument() || runtimePermissionRequest != 0 || permissionOfferDialog != null) return;
        boolean cameraMissing = cameraMissing();
        boolean notificationsMissing = !ReminderScheduler.notificationsAvailable(this);
        boolean notificationRuntimeMissing = Build.VERSION.SDK_INT >= 33 && !ReminderScheduler.permissionGranted(this);
        int next = startupPermissions.next(cameraMissing, "settings_required".equals(cameraPermissionState()),
            notificationsMissing, notificationRuntimeMissing, permissionPrefs().getBoolean("notificationsBlocked", false));
        if (next == StartupPermissionFlow.CAMERA || next == StartupPermissionFlow.NOTIFICATIONS) {
            String permission = next == StartupPermissionFlow.CAMERA ? Manifest.permission.CAMERA : Manifest.permission.POST_NOTIFICATIONS;
            try { launchPermissionDialog(new String[]{permission}, STARTUP_REQUEST); }
            catch (RuntimeException unavailable) { webView.post(this::advanceStartupPermissions); }
            return;
        }
        if (next == StartupPermissionFlow.SETTINGS) {
            String missing = (cameraMissing ? "Камера: Разрешения → Камера → Разрешить при использовании.\n\n" : "")
                + (notificationsMissing ? "Уведомления: Уведомления → включить напоминания о разминке.\n\n" : "");
            AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Включи доступ в настройках")
                .setMessage("Чтобы включить этот доступ, нужен экран настроек Android.\n\n" + missing
                    + "После этого вернись в приложение.")
                .setNegativeButton("Позже", null).setPositiveButton("Настройки", (ignored, which) -> openPermissionSettings()).create();
            permissionOfferDialog = dialog;
            dialog.setOnDismissListener(ignored -> {
                if (permissionOfferDialog == dialog) permissionOfferDialog = null;
                completeCameraAccess();
            });
            dialog.show();
        }
        completeCameraAccess();
        notifyPermissionsChanged();
    }
    private void requestCameraAccess() {
        cameraBridgeOutcome = null;
        if (cameraGranted()) { completeCameraAccess(); return; }
        if (!getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            cameraBridgeOutcome = "unavailable"; completeCameraAccess(); return;
        }
        if ("settings_required".equals(cameraPermissionState())) { completeCameraAccess(); return; }
        try { launchPermissionDialog(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST); }
        catch (RuntimeException unavailable) {
            cameraBridgeOutcome = "unavailable"; completeCameraAccess();
        }
    }
    private void cameraPermissionResult(String requestId, String outcome) {
        JSONObject result = new JSONObject();
        String state = cameraPermissionState();
        try { result.put("requestId", requestId).put("status", outcome).put("granted", cameraGranted())
            .put("canAskAgain", !"settings_required".equals(state)).put("state", state); }
        catch (org.json.JSONException ignored) { }
        evaluate("window.MoveApp&&typeof MoveApp.nativeCameraPermissionResult==='function'&&MoveApp.nativeCameraPermissionResult("
            + result.toString() + ");");
    }
    private void completeCameraAccess() {
        // Permission results can precede onResume. Never start capture behind the system dialog.
        if (!foreground || runtimePermissionRequest != 0 || startupPermissions.active
            || permissionOfferDialog != null || !isTrustedDocument()) return;
        if (cameraRequestDeferred) {
            cameraRequestDeferred = false;
            if (!cameraGranted() && (pendingCameraBridgeId != null || pendingCamera != null)) { requestCameraAccess(); return; }
        }
        PermissionRequest request = pendingCamera;
        pendingCamera = null;
        if (request != null) {
            if (cameraGranted() && cameraBridgeOutcome == null && trustedOrigin(request.getOrigin()))
                request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else request.deny();
        }
        if (pendingCameraBridgeId != null) {
            String id = pendingCameraBridgeId;
            pendingCameraBridgeId = null;
            String outcome = cameraBridgeOutcome != null ? cameraBridgeOutcome
                : cameraGranted() ? "granted" : "settings_required".equals(cameraPermissionState()) ? "settings_required" : "denied";
            cameraBridgeOutcome = null;
            cameraPermissionResult(id, outcome);
        }
        cameraBridgeOutcome = null;
    }

    public final class ShareBridge {
        @JavascriptInterface public void shareImage(String dataUrl, String requestId) {
            if (dataUrl == null || dataUrl.length() > ResultImageProvider.MAX_BYTES * 4 / 3 + 128
                || requestId == null || requestId.length() > 70) return;
            runOnUiThread(() -> { if (foreground && isTrustedDocument() && shareController != null) shareController.share(dataUrl, requestId); });
        }
    }

    private void configureReminder(String json) {
        String id = "";
        try {
            JSONObject input = new JSONObject(json);
            id = input.optString("requestId", "");
            if (id.length() > 80) throw new IllegalArgumentException("Request ID too long");
            ReminderScheduler.Config config = ReminderScheduler.Config.parse(input);
            if (config.enabled && (runtimePermissionRequest != 0 || startupPermissions.active || permissionOfferDialog != null)) {
                reminderResult(id, "busy"); return;
            }
            ReminderScheduler.save(this, config);
            if (!config.enabled) {
                pendingReminderId = null;
                ReminderScheduler.cancel(this);
                reminderResult(id, "disabled");
                return;
            }
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ReminderScheduler.cancel(this);
                if (permissionPrefs().getBoolean("notificationsBlocked", false)) {
                    reminderResult(id, "permission_required"); return;
                }
                pendingReminderId = id;
                reminderResult(id, "permission_requested");
                launchPermissionDialog(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_REQUEST);
            } else reminderResult(id, ReminderScheduler.rearm(this));
        } catch (org.json.JSONException | IllegalArgumentException error) {
            reminderResult(id, "invalid");
        } catch (RuntimeException unavailable) {
            notificationPermissionInFlight = false;
            pendingReminderId = null;
            ReminderScheduler.cancel(this);
            reminderResult(id, "unavailable");
        }
    }

    private void reminderResult(String requestId, String status) {
        JSONObject result = ReminderScheduler.status(this, status);
        try { result.put("requestId", requestId); } catch (org.json.JSONException ignored) { }
        evaluate("window.MoveApp&&typeof MoveApp.nativeReminderResult==='function'&&MoveApp.nativeReminderResult(" + result.toString() + ");");
    }
    private void notifyPermissionsChanged() {
        evaluate("window.MoveApp&&typeof MoveApp.nativePermissionsChanged==='function'&&MoveApp.nativePermissionsChanged();");
    }

    private final class CameraChromeClient extends WebChromeClient {
        @Override public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                String[] resources = request.getResources();
                if (!foreground || !isTrustedDocument() || !trustedOrigin(request.getOrigin())
                    || resources.length != 1 || !PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resources[0])
                    || pendingCamera != null) { request.deny(); return; }
                if (cameraGranted() && runtimePermissionRequest == 0 && !startupPermissions.active && permissionOfferDialog == null) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    return;
                }
                pendingCamera = request;
                if (runtimePermissionRequest == 0 && !startupPermissions.active && permissionOfferDialog == null) requestCameraAccess();
                else cameraRequestDeferred = !cameraPermissionInFlight && !cameraGranted();
            });
        }
        @Override public void onPermissionRequestCanceled(PermissionRequest request) {
            runOnUiThread(() -> { if (pendingCamera == request) pendingCamera = null; });
        }
        @Override public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false);
        }
    }

    private void denyPendingCamera() {
        PermissionRequest request = pendingCamera;
        pendingCamera = null;
        if (request != null) request.deny();
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code != CAMERA_REQUEST && code != NOTIFICATION_REQUEST && code != STARTUP_REQUEST) return;
        boolean requestedCamera = cameraPermissionInFlight;
        runtimePermissionRequest = 0;
        cameraPermissionInFlight = false;
        notificationPermissionInFlight = false;
        rememberPermissionResults(permissions, grants);
        if (grants.length == 0 && requestedCamera) cameraBridgeOutcome = "cancelled";
        String id = pendingReminderId;
        pendingReminderId = null;
        // A grant alone never enables reminders or starts capture. Only finish a live user's request.
        String status = ReminderScheduler.rearm(this);
        if (id != null) reminderResult(id, status);
        if (code == STARTUP_REQUEST) advanceStartupPermissions();
        completeCameraAccess();
        notifyPermissionsChanged();
    }

    @SuppressWarnings("deprecation") @Override public void onBackPressed() { handleBack(); }
    private void handleBack() {
        if (!isTrustedDocument()) { finish(); return; }
        if (exitDialog != null) return;
        webView.evaluateJavascript("(function(){if(window.CityShare&&CityShare.isOpen&&CityShare.isOpen()){CityShare.close();return true;}return !!(window.MoveApp&&typeof MoveApp.handleBack==='function'&&MoveApp.handleBack());})()", result -> {
            if (destroyed || isFinishing() || "true".equals(result)) return;
            exitDialog = new AlertDialog.Builder(this).setTitle("Закрыть Arseniy Move?")
                .setMessage("Тренировка будет остановлена. Сохранённые результаты останутся.")
                .setNegativeButton("Продолжить", null).setPositiveButton("Закрыть", (dialog, which) -> finish()).create();
            exitDialog.setOnDismissListener(dialog -> exitDialog = null);
            exitDialog.show();
        });
    }

    private final class LocalClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            return !request.isForMainFrame() || !localAsset(uri) || !"/assets/app/index.html".equals(uri.getPath());
        }
        @SuppressWarnings("deprecation") @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            return !localAsset(uri) || !"/assets/app/index.html".equals(uri.getPath());
        }
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            speechRequestEpoch.incrementAndGet();
            if (speechController != null) speechController.stop();
            denyPendingCamera();
            pendingCameraBridgeId = null;
            cameraBridgeOutcome = null;
            cameraRequestDeferred = false;
            Uri uri = Uri.parse(url);
            // Safe startup capability reads are available before module scripts run.
            // Side effects additionally check the live top-level URL on the UI thread.
            documentReady = localAsset(uri) && "/assets/app/index.html".equals(uri.getPath());
        }
        @Override public void onPageCommitVisible(WebView view, String url) {
            Uri uri = Uri.parse(url);
            documentReady = localAsset(uri) && "/assets/app/index.html".equals(uri.getPath());
            requestStartupPermissions();
        }
        @Override public void onPageFinished(WebView view, String url) {
            Uri uri = Uri.parse(url);
            documentReady = localAsset(uri) && "/assets/app/index.html".equals(uri.getPath());
            requestStartupPermissions();
            completeCameraAccess();
        }
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!"GET".equals(request.getMethod()) || !localAsset(uri)) return error(403, "Forbidden");
            String path = LocalAssetPath.resolve(uri.getPath());
            try {
                InputStream stream = getAssets().open(path);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                headers.put("X-Content-Type-Options", "nosniff");
                headers.put("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
                headers.put("Cross-Origin-Opener-Policy", "same-origin");
                headers.put("Cross-Origin-Embedder-Policy", "require-corp");
                headers.put("Cross-Origin-Resource-Policy", "same-origin");
                headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
                String mime = mimeType(path);
                if (path.endsWith(".mp4")) {
                    long length;
                    try { length = videoLength(path); }
                    catch (IOException failure) { stream.close(); throw failure; }
                    headers.put("Accept-Ranges", "bytes");
                    String range = null;
                    boolean conditionalRange = false;
                    for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                        if ("Range".equalsIgnoreCase(header.getKey())) range = header.getValue();
                        if ("If-Range".equalsIgnoreCase(header.getKey())) conditionalRange = true;
                    }
                    // No ETag validator is exposed: conditional requests safely receive the full representation.
                    if (conditionalRange) range = null;
                    long[] bounds;
                    try { bounds = parseVideoRange(range, length); }
                    catch (IllegalArgumentException invalid) {
                        stream.close();
                        headers.put("Content-Range", "bytes */" + length);
                        headers.put("Content-Length", "0");
                        return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", headers, new ByteArrayInputStream(new byte[0]));
                    }
                    long start = bounds[0], count = bounds[1] - start + 1;
                    try { skipFully(stream, start); }
                    catch (IOException failure) { stream.close(); throw failure; }
                    headers.put("Content-Length", Long.toString(count));
                    if (range != null) headers.put("Content-Range", "bytes " + start + "-" + bounds[1] + "/" + length);
                    return new WebResourceResponse(mime, null, range == null ? 200 : 206,
                        range == null ? "OK" : "Partial Content", headers, new BoundedStream(stream, count));
                }
                return new WebResourceResponse(mime, mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") ? "UTF-8" : null,
                    200, "OK", headers, stream);
            } catch (IOException missing) { return error(404, "Not Found"); }
        }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
            if (request.isForMainFrame()) Toast.makeText(MainActivity.this, "Не удалось открыть тренировку. Перезапусти приложение.", Toast.LENGTH_LONG).show();
        }
        @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
            documentReady = false;
            denyPendingCamera();
            ((FrameLayout)view.getParent()).removeView(view);
            view.destroy();
            webView = null;
            if (!destroyed && !isFinishing()) new AlertDialog.Builder(MainActivity.this)
                .setTitle("Перезапустим экран").setMessage("Камера остановлена. Сохранённые результаты останутся.")
                .setCancelable(false).setPositiveButton("Открыть", (dialog, which) -> recreate()).show();
            return true;
        }
    }

    private long videoLength(String path) throws IOException {
        Long cached = videoLengths.get(path);
        if (cached != null) return cached;
        long length;
        try (android.content.res.AssetFileDescriptor descriptor = getAssets().openFd(path)) {
            length = descriptor.getLength();
        } catch (IOException compressedAsset) {
            // APKs normally store MP4 uncompressed. Fallback counts a compressed
            // asset once using a small buffer, never a full-video byte array.
            length = 0;
            try (InputStream source = getAssets().open(path)) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = source.read(buffer)) != -1) length += count;
            }
        }
        videoLengths.put(path, length);
        return length;
    }
    static long[] parseVideoRange(String raw, long length) {
        if (raw == null) return new long[]{0, length - 1};
        if (length <= 0 || raw.length() > 100 || !raw.trim().matches("bytes=[0-9]*-[0-9]*")) throw new IllegalArgumentException("Invalid byte range");
        String[] parts = raw.trim().substring(6).split("-", -1);
        try {
            if (parts[0].isEmpty()) {
                long suffix = Long.parseLong(parts[1]);
                if (suffix <= 0) throw new IllegalArgumentException("Invalid suffix");
                return new long[]{Math.max(0, length - suffix), length - 1};
            }
            long start = Long.parseLong(parts[0]);
            long end = parts[1].isEmpty() ? length - 1 : Math.min(length - 1, Long.parseLong(parts[1]));
            if (start >= length || end < start) throw new IllegalArgumentException("Unsatisfiable range");
            return new long[]{start, end};
        } catch (NumberFormatException invalid) { throw new IllegalArgumentException("Invalid range value", invalid); }
    }
    private static void skipFully(InputStream source, long count) throws IOException {
        while (count > 0) {
            long skipped = source.skip(count);
            if (skipped == 0) {
                if (source.read() == -1) throw new IOException("Video ended before range start");
                skipped = 1;
            }
            count -= skipped;
        }
    }
    private static final class BoundedStream extends FilterInputStream {
        private long remaining;
        BoundedStream(InputStream source, long count) { super(source); remaining = count; }
        @Override public int read() throws IOException {
            if (remaining == 0) return -1;
            int value = in.read();
            if (value != -1) remaining--;
            return value;
        }
        @Override public int read(byte[] buffer, int offset, int count) throws IOException {
            if (count == 0) return 0;
            if (remaining == 0) return -1;
            int read = in.read(buffer, offset, (int)Math.min(count, remaining));
            if (read > 0) remaining -= read;
            return read;
        }
        @Override public long skip(long count) throws IOException {
            long skipped = in.skip(Math.min(Math.max(0, count), remaining));
            remaining -= skipped;
            return skipped;
        }
        @Override public int available() throws IOException { return (int)Math.min(in.available(), remaining); }
        @Override public boolean markSupported() { return false; }
        @Override public synchronized void mark(int limit) { }
        @Override public synchronized void reset() throws IOException { throw new IOException("Range stream cannot reset"); }
    }

    static String mimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript";
        if (path.endsWith(".wasm")) return "application/wasm";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".mp3")) return "audio/mpeg";
        if (path.endsWith(".wav")) return "audio/wav";
        if (path.endsWith(".mp4")) return "video/mp4";
        if (path.endsWith(".webm")) return "video/webm";
        if (path.endsWith(".vtt")) return "text/vtt";
        return "application/octet-stream"; // Includes MediaPipe .task/.tflite model data.
    }
    private static WebResourceResponse error(int code, String message) {
        return new WebResourceResponse("text/plain", "UTF-8", code, message, new HashMap<>(),
            new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        mediaPausedForBackground = false;
        if (webView != null) webView.onResume();
        if (cameraGranted()) permissionPrefs().edit().putBoolean("cameraBlocked", false).putBoolean("cameraDenied", false).apply();
        if (ReminderScheduler.permissionGranted(this)) permissionPrefs().edit().putBoolean("notificationsBlocked", false).apply();
        ReminderScheduler.rearm(this); // No permission prompt; restore saved choice after settings/boot.
        requestStartupPermissions();
        completeCameraAccess();
        notifyPermissionsChanged();
        if (updateController != null) updateController.resume();
    }
    @Override protected void onPause() {
        foreground = false;
        speechRequestEpoch.incrementAndGet();
        if (speechController != null) speechController.stop();
        // Runtime permission UI is a temporary pause. Cancelling here used to reject
        // getUserMedia even when the child tapped Allow. Actual backgrounding reaches onStop.
        if (runtimePermissionRequest == 0) pauseMediaForBackground();
        super.onPause();
    }
    @Override protected void onStop() {
        foreground = false;
        speechRequestEpoch.incrementAndGet();
        if (speechController != null) speechController.stop();
        pauseMediaForBackground();
        super.onStop();
    }
    private void pauseMediaForBackground() {
        if (mediaPausedForBackground) return;
        mediaPausedForBackground = true;
        denyPendingCamera();
        if (webView != null) {
            // Cleanup must run even when finish() already makes bridge calls invalid.
            if (documentReady && !destroyed) webView.evaluateJavascript("(function(){try{if(window.MoveApp&&typeof MoveApp.pauseForBackground==='function')MoveApp.pauseForBackground();}catch(e){}document.querySelectorAll('video').forEach(function(v){v.pause();var s=v.srcObject;if(s&&s.getTracks)s.getTracks().forEach(function(t){t.stop();});v.srcObject=null;});})()", null);
            webView.onPause();
        }
        if (pendingCameraBridgeId != null) {
            String id = pendingCameraBridgeId;
            pendingCameraBridgeId = null;
            cameraPermissionResult(id, "cancelled");
        }
        cameraBridgeOutcome = null;
        cameraRequestDeferred = false;
    }
    @Override protected void onDestroy() {
        foreground = false;
        speechRequestEpoch.incrementAndGet();
        if (speechController != null) { speechController.destroy(); speechController = null; }
        denyPendingCamera();
        pendingCameraBridgeId = null;
        documentReady = false;
        destroyed = true;
        if (shareController != null) { shareController.destroy(); shareController = null; }
        if (exitDialog != null) exitDialog.dismiss();
        if (permissionOfferDialog != null) { permissionOfferDialog.dismiss(); permissionOfferDialog = null; }
        if (webView != null) {
            webView.removeJavascriptInterface("MoveNative");
            webView.removeJavascriptInterface("AndroidShare");
            webView.stopLoading();
            ((FrameLayout)webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        if (updateController != null) { updateController.close(); updateController = null; }
        super.onDestroy();
    }
}
