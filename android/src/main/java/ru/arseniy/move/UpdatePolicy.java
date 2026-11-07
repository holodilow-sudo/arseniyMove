package ru.arseniy.move;

import java.net.URI;
import java.util.Arrays;

/** Pure validation shared by the downloader and host-side tests. */
final class UpdatePolicy {
    static final String REPOSITORY = "holodilow-sudo/arseniyMove";
    static final String API = "https://api.github.com/repos/" + REPOSITORY + "/releases/latest";
    static final String PACKAGE = "ru.arseniy.move";
    static final long MAX_APK_BYTES = 180L * 1024 * 1024;
    static final long AUTO_INTERVAL_MS = 6L * 60 * 60 * 1000;
    static final long RETRY_INTERVAL_MS = 15L * 60 * 1000;

    static int[] version(String value) {
        if (value == null || !value.matches("(0|[1-9][0-9]{0,4})\\.(0|[1-9][0-9]{0,4})\\.(0|[1-9][0-9]{0,4})"))
            throw new IllegalArgumentException("Invalid release version");
        return Arrays.stream(value.split("\\.")).mapToInt(Integer::parseInt).toArray();
    }
    static boolean newer(String candidate, String installed) {
        int[] a = version(candidate), b = version(installed);
        for (int i = 0; i < 3; i++) if (a[i] != b[i]) return a[i] > b[i];
        return false;
    }
    static String releaseVersion(String tag) {
        String v = tag != null && tag.startsWith("v") ? tag.substring(1) : tag;
        version(v); return v;
    }
    static String apkName(String v) { version(v); return "ArseniyMove-" + v + ".apk"; }
    static boolean validDigest(String hash) { return hash != null && hash.matches("[a-fA-F0-9]{64}"); }
    static boolean sizeAllowed(long size) { return size > 0 && size <= MAX_APK_BYTES; }
    static boolean due(long now, long last, long interval) { return last <= 0 || now < last || now - last >= interval; }
    static boolean allowedUrl(String value) {
        try {
            URI u = new URI(value);
            if (!"https".equals(u.getScheme()) || u.getUserInfo() != null || u.getFragment() != null
                    || (u.getPort() != -1 && u.getPort() != 443)) return false;
            String host = u.getHost(), path = u.getPath();
            if (path == null || path.contains("..") || path.contains("\\")) return false;
            if ("api.github.com".equals(host)) return ("/repos/" + REPOSITORY + "/releases/latest").equals(path);
            if ("github.com".equals(host)) return path.startsWith("/" + REPOSITORY + "/releases/download/");
            return "release-assets.githubusercontent.com".equals(host) || "objects.githubusercontent.com".equals(host)
                    || "github-releases.githubusercontent.com".equals(host);
        } catch (Exception ignored) { return false; }
    }
    static boolean assetUrl(String url, String tag, String name) {
        return allowedUrl(url) && url.equals("https://github.com/" + REPOSITORY + "/releases/download/" + tag + "/" + name);
    }
    static boolean matchingSignatures(String[] installed, String[] candidate) {
        if (installed == null || candidate == null || installed.length == 0 || installed.length != candidate.length) return false;
        String[] a = installed.clone(), b = candidate.clone(); Arrays.sort(a); Arrays.sort(b);
        return Arrays.equals(a, b);
    }
    static boolean validPackage(String name, long code, long currentCode, String version,
            String expectedVersion, int minimumApi, int deviceApi, boolean debug,
            String[] installedSignatures, String[] candidateSignatures) {
        return PACKAGE.equals(name) && code > currentCode && expectedVersion.equals(version)
                && minimumApi <= deviceApi && !debug && matchingSignatures(installedSignatures, candidateSignatures);
    }
}
