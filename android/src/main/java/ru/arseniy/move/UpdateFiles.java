package ru.arseniy.move;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Locale;

/** Bounded streaming: a truncated, oversized or altered download is never accepted. */
final class UpdateFiles {
    interface Progress { void received(long count) throws IOException; }
    static void copy(InputStream in, OutputStream out, long expectedSize, String expectedHash, Progress progress) throws Exception {
        if (!UpdatePolicy.sizeAllowed(expectedSize) || !UpdatePolicy.validDigest(expectedHash)) throw new IOException("Invalid expected file");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[65536]; long count = 0; int n;
        while ((n=in.read(buffer)) != -1) {
            if ((count+=n)>expectedSize) throw new IOException("Oversized download");
            progress.received(count);out.write(buffer,0,n);digest.update(buffer,0,n);
        }
        if (count != expectedSize || !hex(digest.digest()).equalsIgnoreCase(expectedHash)) throw new IOException("Incomplete or altered download");
    }
    static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder();for(byte b:bytes)value.append(String.format(Locale.ROOT,"%02x",b&255));return value.toString();
    }
}
