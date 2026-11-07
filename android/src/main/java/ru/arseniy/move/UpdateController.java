package ru.arseniy.move;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Only release metadata and APK bytes cross the network; never receives camera or history data. */
final class UpdateController {
    interface Feedback { boolean canInstall(); void status(String json); }
    private final Activity activity;
    private final Feedback feedback;
    private final SharedPreferences prefs;
    private final File directory, ready, partial;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private volatile boolean closed, allowed, restored;
    private volatile HttpURLConnection connection;
    private volatile String state = "idle", message = "Проверяем новые версии при открытии приложения.", version = "";
    private volatile int percent = -1;
    private boolean waitingForPermission;

    UpdateController(Activity activity, Feedback feedback) {
        this.activity = activity; this.feedback = feedback;
        prefs = activity.getSharedPreferences("move-updates-v1", 0);
        directory = new File(activity.getFilesDir(), "updates");
        ready = new File(directory, "update.apk"); partial = new File(directory, "download.part");
    }
    String status() {
        JSONObject j = new JSONObject();
        try { j.put("state",state).put("message",message).put("version",version).put("percent",percent)
                .put("lastChecked",prefs.getLong("lastSuccess",0)); } catch (Exception ignored) { }
        return j.toString();
    }
    private void emit(String next, String text, int progress) {
        state = next; message = text; percent = progress;
        activity.runOnUiThread(() -> { if (!closed) feedback.status(status()); });
    }
    void allow(boolean value) { allowed = value; if (value) check(false); }
    void check(boolean manual) {
        if (closed || !allowed || !busy.compareAndSet(false,true)) return;
        worker.execute(() -> {
            try {
                if (!restored) { restore(); restored = true; }
                if ("ready".equals(state) || "permission".equals(state)) return;
                long now = System.currentTimeMillis();
                if (!manual && (!UpdatePolicy.due(now,prefs.getLong("lastSuccess",0),UpdatePolicy.AUTO_INTERVAL_MS)
                        || !UpdatePolicy.due(now,prefs.getLong("lastAttempt",0),UpdatePolicy.RETRY_INTERVAL_MS))) return;
                if (manual && !UpdatePolicy.due(now,prefs.getLong("lastAttempt",0),15000)) return;
                prefs.edit().putLong("lastAttempt",now).apply();
                emit("checking","Проверяем обновления…",-1);
                String json;
                try { json = text(UpdatePolicy.API,1024*1024); }
                catch (HttpFailure e) {
                    if (e.code != 404) throw e;
                    emit("unpublished","Новых выпусков пока нет. Тренироваться можно как обычно.",-1); return;
                }
                JSONObject release = new JSONObject(json);
                if (release.optBoolean("draft",true) || release.optBoolean("prerelease",true))
                    throw new IOException("Unpublished release");
                String tag = release.getString("tag_name"), latest = UpdatePolicy.releaseVersion(tag);
                PackageInfo current = installed();
                if (!UpdatePolicy.newer(latest,current.versionName)) {
                    prefs.edit().putLong("lastSuccess",now).apply();
                    emit("current","Установлена последняя версия.",-1); return;
                }
                String filename = UpdatePolicy.apkName(latest);
                JSONArray assets = release.getJSONArray("assets"); JSONObject apk = null, checksum = null;
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.getJSONObject(i);
                    if (filename.equals(asset.optString("name"))) {
                        if (apk != null) throw new IOException("Ambiguous APK"); apk = asset;
                    }
                    if ((filename+".sha256").equals(asset.optString("name"))) checksum = asset;
                }
                if (apk == null || !"uploaded".equals(apk.optString("state"))) {
                    emit("unpublished","Новая версия ещё загружается. Проверим позже.",-1); return;
                }
                long size = apk.getLong("size"); String url = apk.getString("browser_download_url");
                if (!UpdatePolicy.sizeAllowed(size) || !UpdatePolicy.assetUrl(url,tag,filename)) throw new IOException("Invalid asset");
                String hash = apk.optString("digest","");
                hash = hash.startsWith("sha256:") ? hash.substring(7) : "";
                if (!UpdatePolicy.validDigest(hash) && checksum != null) {
                    String checksumUrl = checksum.getString("browser_download_url");
                    if (!UpdatePolicy.assetUrl(checksumUrl,tag,filename+".sha256")) throw new IOException("Invalid checksum URL");
                    String[] words = text(checksumUrl,1024).trim().split("\\s+");
                    if (words.length != 2 || !filename.equals(words[1])) throw new IOException("Invalid checksum file");
                    hash = words[0];
                }
                if (!UpdatePolicy.validDigest(hash)) throw new IOException("No release checksum");
                version = latest;
                download(url,size,hash);
                validate(partial,latest,current);
                if (closed) return;
                if (ready.exists() && !ready.delete()) throw new IOException("Cannot replace cached update");
                if (!partial.renameTo(ready)) throw new IOException("Cannot save update");
                if (!prefs.edit().putString("readyVersion",latest).putString("readyHash",hash)
                        .putLong("readySize",size).putLong("lastSuccess",now).commit()) {
                    ready.delete(); throw new IOException("Cannot persist update");
                }
                emit("ready","Версия " + latest + " скачана. Можно установить.",100);
            } catch (Exception e) {
                partial.delete();
                if (!closed) emit("error", e instanceof HttpFailure && (((HttpFailure)e).code == 403 || ((HttpFailure)e).code == 429)
                        ? "GitHub временно ограничил запросы. Попробуй позже."
                        : "Не удалось получить или проверить обновление. Проверь интернет и попробуй позже.",-1);
            } finally { busy.set(false); }
        });
    }
    private void restore() throws Exception {
        partial.delete();
        String v = prefs.getString("readyVersion","");
        if (!ready.isFile() || v.isEmpty()) { discard(); return; }
        try {
            PackageInfo current = installed();
            if (!UpdatePolicy.newer(v,current.versionName)) { discard(); return; }
            verifyFile(ready,prefs.getLong("readySize",0),prefs.getString("readyHash",""));
            validate(ready,v,current); version = v;
            emit("ready","Версия " + v + " скачана. Можно установить.",100);
        } catch (Exception invalid) { discard(); }
    }
    private void discard() {
        ready.delete();
        prefs.edit().remove("readyVersion").remove("readyHash").remove("readySize").apply();
    }
    private HttpURLConnection open(String address) throws IOException {
        for (int redirects = 0; redirects <= 5; redirects++) {
            if (closed || !UpdatePolicy.allowedUrl(address)) throw new IOException("Disallowed update URL");
            HttpURLConnection c = (HttpURLConnection)new URL(address).openConnection(); connection = c;
            c.setInstanceFollowRedirects(false); c.setConnectTimeout(15000); c.setReadTimeout(20000);
            c.setRequestProperty("User-Agent","ArseniyMove-Updater");
            c.setRequestProperty("Accept","application/vnd.github+json, application/octet-stream");
            c.setRequestProperty("Accept-Encoding","identity");
            c.setUseCaches(false);
            int code;
            try { code = c.getResponseCode(); } catch (IOException e) { c.disconnect(); throw e; }
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String target = c.getHeaderField("Location"); c.disconnect();
                if (target == null) throw new IOException("Missing redirect");
                address = new URL(new URL(address),target).toString(); continue;
            }
            if (code != 200) { c.disconnect(); throw new HttpFailure(code); }
            return c;
        }
        throw new IOException("Too many redirects");
    }
    private String text(String url, int limit) throws IOException {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] b = new byte[8192]; int n;
            while ((n = in.read(b)) != -1) { if (closed || out.size()+n > limit) throw new IOException("Response too large"); out.write(b,0,n); }
            return new String(out.toByteArray(),StandardCharsets.UTF_8);
        } finally { c.disconnect(); connection = null; }
    }
    private void download(String url, long size, String expected) throws Exception {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create update cache");
        if (directory.getUsableSpace() < size + 16L*1024*1024) throw new IOException("Not enough space");
        emit("downloading","Скачиваем обновление. Можно продолжать пользоваться приложением.",0);
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(partial)) {
            long declared = c.getContentLengthLong();
            if (declared > 0 && declared != size) throw new IOException("Content size mismatch");
            final long[] lastUi = {0};
            UpdateFiles.copy(in,out,size,expected,count -> {
                if (closed) throw new IOException("Download cancelled");
                long now = System.currentTimeMillis();
                if (now-lastUi[0] > 400) { lastUi[0]=now;emit("downloading","Скачиваем обновление…",(int)(count*100/size)); }
            });
            out.getFD().sync();
        } finally { c.disconnect(); connection = null; }
        emit("verifying","Проверяем подпись приложения…",100);
    }
    private void verifyFile(File file, long size, String hash) throws Exception {
        if (!UpdatePolicy.sizeAllowed(size) || file.length() != size || !UpdatePolicy.validDigest(hash)) throw new IOException("Invalid cached file");
        MessageDigest digest = MessageDigest.getInstance("SHA-256"); byte[] b=new byte[65536]; int n;
        try (InputStream in = new FileInputStream(file)) { while ((n=in.read(b))!=-1) { if (closed) throw new IOException("Closed"); digest.update(b,0,n); } }
        if (!hex(digest.digest()).equalsIgnoreCase(hash)) throw new IOException("Cached checksum mismatch");
    }
    @SuppressWarnings("deprecation")
    private PackageInfo installed() throws PackageManager.NameNotFoundException {
        return activity.getPackageManager().getPackageInfo(activity.getPackageName(), Build.VERSION.SDK_INT>=28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES);
    }
    @SuppressWarnings("deprecation")
    private void validate(File file, String expectedVersion, PackageInfo current) throws Exception {
        PackageInfo candidate = activity.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),
                Build.VERSION.SDK_INT>=28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES);
        if (candidate == null || candidate.applicationInfo == null || !UpdatePolicy.validPackage(candidate.packageName,
                code(candidate),code(current),candidate.versionName,expectedVersion,candidate.applicationInfo.minSdkVersion,
                Build.VERSION.SDK_INT,(candidate.applicationInfo.flags & ApplicationInfo.FLAG_DEBUGGABLE)!=0,
                signatures(current),signatures(candidate))) throw new IOException("Untrusted update APK");
    }
    @SuppressWarnings("deprecation")
    private static long code(PackageInfo info) { return Build.VERSION.SDK_INT>=28 ? info.getLongVersionCode() : info.versionCode; }
    @SuppressWarnings("deprecation")
    private static String[] signatures(PackageInfo info) throws Exception {
        Signature[] s = Build.VERSION.SDK_INT>=28 ? (info.signingInfo==null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        if (s == null) return new String[0]; String[] result = new String[s.length];
        for (int i=0;i<s.length;i++) result[i] = hex(MessageDigest.getInstance("SHA-256").digest(s[i].toByteArray()));
        return result;
    }
    private static String hex(byte[] bytes) {
        StringBuilder s=new StringBuilder(); for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();
    }
    void install() {
        if (closed || !allowed || !feedback.canInstall() || !("ready".equals(state)||"permission".equals(state)) || !busy.compareAndSet(false,true)) return;
        worker.execute(() -> {
            try {
                emit("verifying","Проверяем обновление перед установкой…",100);
                String v = prefs.getString("readyVersion","");
                verifyFile(ready,prefs.getLong("readySize",0),prefs.getString("readyHash",""));
                validate(ready,v,installed());
                activity.runOnUiThread(() -> {
                    if (closed) { busy.set(false); return; }
                    emit("ready","Обновление готово к установке.",100);
                    busy.set(false);
                    if (!allowed || !feedback.canInstall()) return;
                    try {
                        if (!activity.getPackageManager().canRequestPackageInstalls()) {
                            waitingForPermission = true;
                            emit("permission","Один раз разреши установку обновлений из Arseniy Move и вернись в приложение.",100);
                            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())));
                        } else {
                            Uri uri=Uri.parse("content://"+activity.getPackageName()+".updates/update.apk");
                            Intent intent=new Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(uri,"application/vnd.android.package-archive")
                                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            intent.setClipData(ClipData.newRawUri("Arseniy Move update",uri));
                            activity.startActivity(intent);
                        }
                    } catch (RuntimeException failure) {
                        waitingForPermission = false;
                        emit("ready","Не удалось открыть установку. Нажми «Установить» ещё раз.",100);
                    }
                });
            } catch (Exception e) {
                discard(); busy.set(false);
                if (!closed) emit("error","Файл обновления не прошёл проверку. Скачай его заново кнопкой проверки.",-1);
            }
        });
    }
    void resume() {
        if (waitingForPermission) {
            waitingForPermission = false;
            if (activity.getPackageManager().canRequestPackageInstalls()) install();
            else emit("permission","Разрешение на установку пока выключено. Можно продолжать тренировки.",100);
        }
    }
    void close() {
        closed=true;allowed=false;
        HttpURLConnection c=connection;if(c!=null)c.disconnect();worker.shutdownNow();
    }
    private static final class HttpFailure extends IOException { final int code; HttpFailure(int code){super("HTTP "+code);this.code=code;} }
}
