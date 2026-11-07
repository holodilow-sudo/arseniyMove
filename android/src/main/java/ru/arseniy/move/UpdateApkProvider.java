package ru.arseniy.move;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Exposes exactly one verified update APK, with a temporary read grant to Android's installer. */
public final class UpdateApkProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    private File resolve(Uri uri) throws FileNotFoundException {
        if (getContext() == null || uri == null || !"content".equals(uri.getScheme())
                || !(getContext().getPackageName() + ".updates").equals(uri.getAuthority())
                || !"/update.apk".equals(uri.getPath()) || uri.getQuery() != null || uri.getFragment() != null)
            throw new FileNotFoundException("Unknown update URI");
        File f = new File(getContext().getFilesDir(), "updates/update.apk");
        if (!f.isFile() || !UpdatePolicy.sizeAllowed(f.length())) throw new FileNotFoundException("Update unavailable");
        return f;
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public String getType(Uri uri) {
        try { resolve(uri); return "application/vnd.android.package-archive"; }
        catch (FileNotFoundException error) { return null; }
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
        final File f; try { f = resolve(uri); } catch (FileNotFoundException e) { return null; }
        String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor result = new MatrixCursor(columns, 1); Object[] row = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) row[i] = "ArseniyMove-update.apk";
            if (OpenableColumns.SIZE.equals(columns[i])) row[i] = f.length();
        }
        result.addRow(row); return result;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
}
