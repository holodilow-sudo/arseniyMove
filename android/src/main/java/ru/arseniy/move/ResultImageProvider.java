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
import java.io.IOException;
import java.util.List;

/** Read-only, temporary URI grants for result cards; never exposes other app data. */
public final class ResultImageProvider extends ContentProvider {
    static final String DIRECTORY = "result-cards";
    static final int MAX_BYTES = 4 * 1024 * 1024;
    static final String FILE_PATTERN = "result-[0-9]{13}-[a-f0-9-]{36}\\.png";

    @Override public boolean onCreate() { return true; }

    private File resolve(Uri uri) throws FileNotFoundException {
        if (getContext() == null || uri == null || !"content".equals(uri.getScheme())
                || !(getContext().getPackageName() + ".results").equals(uri.getAuthority())
                || uri.getQuery() != null || uri.getFragment() != null) {
            throw new FileNotFoundException("Unknown result URI");
        }
        List<String> parts = uri.getPathSegments();
        if (parts.size() != 2 || !"result".equals(parts.get(0))
                || !parts.get(1).matches(FILE_PATTERN)) throw new FileNotFoundException("Unknown result path");
        try {
            File directory = new File(getContext().getCacheDir(), DIRECTORY).getCanonicalFile();
            File file = new File(directory, parts.get(1)).getCanonicalFile();
            if (!directory.equals(file.getParentFile()) || !file.isFile()
                    || file.length() <= 0 || file.length() > MAX_BYTES) {
                throw new FileNotFoundException("Result unavailable");
            }
            return file;
        } catch (IOException error) { throw new FileNotFoundException("Result unavailable"); }
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public String getType(Uri uri) {
        try { resolve(uri); return "image/png"; }
        catch (FileNotFoundException error) { return null; }
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection,
            String[] selectionArgs, String sortOrder) {
        final File file;
        try { file = resolve(uri); } catch (FileNotFoundException error) { return null; }
        String[] columns = projection == null
                ? new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        Object[] row = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) row[i] = "Arseniy-Move-Result.png";
            else if (OpenableColumns.SIZE.equals(columns[i])) row[i] = file.length();
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
}
