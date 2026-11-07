package ru.arseniy.move;

import java.io.InputStream;
import java.util.zip.ZipFile;

/** Tests the production resolver against exact entries of an already built APK. */
public final class LocalAssetPathTest {
    private static int checks;
    private static void expect(boolean value, String label) {
        checks++;
        if (!value) throw new AssertionError(label);
    }
    public static void main(String[] args) throws Exception {
        expect(MainActivity.LocalAssetPath.resolve(null) == null, "null rejected");
        expect(MainActivity.LocalAssetPath.resolve("/assets/app/../private") == null, "parent traversal rejected");
        expect(MainActivity.LocalAssetPath.resolve("/assets/app//../private") == null, "double-slash traversal rejected before normalization");
        expect(MainActivity.LocalAssetPath.resolve("/assets/app/./index.html") == null, "dot path rejected");
        expect(MainActivity.LocalAssetPath.resolve("/assets/app/%2e%2e/private") == null, "undecoded traversal rejected");
        expect(MainActivity.LocalAssetPath.resolve("/assets/app/a\\b") == null, "backslash rejected");
        expect(MainActivity.LocalAssetPath.resolve("/assets/elsewhere/file") == null, "outside app rejected");
        expect(MainActivity.LocalAssetPath.resolve("/assets//app/index.html") == null, "alternate trusted-root spelling rejected");
        expect("app/index.html".equals(MainActivity.LocalAssetPath.resolve("/assets/app/index.html")), "ordinary path unchanged");
        expect("app/vendor/wasm/file.wasm".equals(MainActivity.LocalAssetPath.resolve("/assets/app/vendor///wasm//file.wasm")), "repeated separators normalized after validation");
        String[] filenames = {"vision_wasm_module_internal.js", "vision_wasm_module_internal.wasm", "vision_wasm_internal.js", "vision_wasm_internal.wasm"};
        try (ZipFile apk = new ZipFile(args[0])) {
            for (String filename : filenames) {
                String request = "/assets/app/vendor/wasm//" + filename;
                expect(apk.getEntry(request.substring(1)) == null, "old raw lookup fails: " + filename);
                String resolved = "assets/" + MainActivity.LocalAssetPath.resolve(request);
                expect(apk.getEntry(resolved) != null, "production normalized lookup finds: " + filename);
                try (InputStream input = apk.getInputStream(apk.getEntry(resolved))) {
                    expect(input.read() >= 0, "asset bytes readable: " + filename);
                }
            }
        }
        System.out.println("PASS " + checks + " asset-path checks against real APK ZIP entries; includes four reproduced old lookup failures");
    }
}
