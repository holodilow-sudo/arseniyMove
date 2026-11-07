package ru.arseniy.move;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.Comparator;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Validates and re-encodes one local PNG, then opens Android's user-controlled share sheet. */
final class ResultShareController {
    interface Feedback {
        boolean trusted();
        void result(String requestId, String status);
    }
    private static final String PREFIX = "data:image/png;base64,";
    private final Activity activity;
    private final Feedback feedback;
    private final ExecutorService writer = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private volatile boolean closed;

    ResultShareController(Activity activity, Feedback feedback) {
        this.activity = activity;
        this.feedback = feedback;
    }

    // Must be called on the UI thread, where the current WebView origin is checked.
    void share(String dataUrl, String requestId) {
        if (closed || !feedback.trusted() || requestId == null
                || !requestId.matches("share-[a-zA-Z0-9-]{1,64}")) return;
        if (dataUrl == null || !dataUrl.startsWith(PREFIX)
                || dataUrl.length() > (ResultImageProvider.MAX_BYTES * 4 / 3 + 128)) {
            feedback.result(requestId, "invalid"); return;
        }
        if (!busy.compareAndSet(false, true)) { feedback.result(requestId, "busy"); return; }
        writer.execute(() -> {
            File file = null;
            try {
                file = saveImage(dataUrl);
                final File prepared = file;
                activity.runOnUiThread(() -> {
                    busy.set(false);
                    if (closed || !feedback.trusted()) { prepared.delete(); return; }
                    Uri uri = new Uri.Builder().scheme("content")
                            .authority(activity.getPackageName() + ".results")
                            .appendPath("result").appendPath(prepared.getName()).build();
                    Intent send = new Intent(Intent.ACTION_SEND).setType("image/png")
                            .putExtra(Intent.EXTRA_STREAM, uri)
                            .putExtra(Intent.EXTRA_TITLE, "Результат Арсения — Arseniy Move")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    send.setClipData(ClipData.newUri(activity.getContentResolver(), "Результат Арсения", uri));
                    Intent chooser = Intent.createChooser(send, "Поделиться с папой")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    chooser.setClipData(send.getClipData());
                    try {
                        activity.startActivity(chooser);
                        // A chooser opening is not evidence of a delivered message.
                        feedback.result(requestId, "opened");
                    } catch (ActivityNotFoundException unavailable) { feedback.result(requestId, "unavailable"); }
                    catch (RuntimeException error) { feedback.result(requestId, "error"); }
                });
            } catch (IOException | RuntimeException error) {
                if (file != null) file.delete();
                activity.runOnUiThread(() -> { busy.set(false); if (!closed && feedback.trusted()) feedback.result(requestId, "invalid"); });
            }
        });
    }

    private File saveImage(String dataUrl) throws IOException {
        byte[] bytes = Base64.decode(dataUrl.substring(PREFIX.length()), Base64.NO_WRAP);
        if (bytes.length < 24 || bytes.length > ResultImageProvider.MAX_BYTES
                || bytes[0] != (byte)137 || bytes[1] != 80 || bytes[2] != 78 || bytes[3] != 71
                || bytes[4] != 13 || bytes[5] != 10 || bytes[6] != 26 || bytes[7] != 10) {
            throw new IOException("Invalid PNG");
        }
        BitmapFactory.Options size = new BitmapFactory.Options();
        size.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, size);
        if (size.outWidth < 1 || size.outHeight < 1 || size.outWidth > 1800 || size.outHeight > 1800
                || ((long)size.outWidth * size.outHeight) > 2500000L) throw new IOException("Image too large");
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bitmap == null) throw new IOException("Invalid image");
        File directory = new File(activity.getCacheDir(), ResultImageProvider.DIRECTORY);
        if (!directory.isDirectory() && !directory.mkdirs()) { bitmap.recycle(); throw new IOException("Cache unavailable"); }
        cleanup(directory);
        File output = new File(directory, "result-" + System.currentTimeMillis() + "-" + UUID.randomUUID() + ".png");
        try (FileOutputStream stream = new FileOutputStream(output)) {
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) throw new IOException("PNG unavailable");
        } catch (IOException error) { output.delete(); throw error; }
        finally { bitmap.recycle(); }
        if (output.length() > ResultImageProvider.MAX_BYTES) { output.delete(); throw new IOException("Image too large"); }
        return output;
    }

    private void cleanup(File directory) {
        File[] files = directory.listFiles(file -> file.isFile() && file.getName().matches(ResultImageProvider.FILE_PATTERN));
        if (files == null) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
        long expiry = System.currentTimeMillis() - 48L * 60 * 60 * 1000;
        // Keep recent cards long enough for a recipient app to finish reading them.
        for (int i = 0; i < files.length; i++) {
            if (i >= 11 || files[i].lastModified() < expiry) {
                Uri uri = new Uri.Builder().scheme("content").authority(activity.getPackageName() + ".results")
                        .appendPath("result").appendPath(files[i].getName()).build();
                activity.revokeUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                files[i].delete();
            }
        }
    }

    void destroy() { closed = true; writer.shutdownNow(); }
}
