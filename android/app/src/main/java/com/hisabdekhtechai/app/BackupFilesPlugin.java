package com.hisabdekhtechai.app;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** User-selected documents only; no broad storage permission or private database path access. */
@CapacitorPlugin(name = "BackupFiles")
public class BackupFilesPlugin extends Plugin {
    private static final int MAX_BYTES = 40 * 1024 * 1024;

    @PluginMethod public void save(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) { call.reject("BACKUP_TOO_LARGE"); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "hisab-backup.json"));
        startActivityForResult(call, intent, "saved");
    }

    @ActivityCallback private void saved(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.reject("CANCELLED"); return; }
        getBridge().execute(() -> {
            try (OutputStream out = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                if (out == null) throw new IllegalStateException("Document unavailable");
                out.write(call.getString("text").getBytes(StandardCharsets.UTF_8)); out.flush();
                call.resolve();
            } catch (Exception e) { call.reject("Could not save backup document."); }
        });
    }

    @PluginMethod public void open(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "opened");
    }

    @ActivityCallback private void opened(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.reject("CANCELLED"); return; }
        getBridge().execute(() -> {
            try (InputStream in = getContext().getContentResolver().openInputStream(result.getData().getData());
                 ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                if (in == null) throw new IllegalStateException("Document unavailable");
                byte[] buffer = new byte[8192]; int size;
                while ((size = in.read(buffer)) != -1) {
                    if (bytes.size() + size > MAX_BYTES) { call.reject("BACKUP_TOO_LARGE"); return; }
                    bytes.write(buffer, 0, size);
                }
                JSObject response = new JSObject(); response.put("text", new String(bytes.toByteArray(), StandardCharsets.UTF_8)); call.resolve(response);
            } catch (Exception e) { call.reject("Could not open backup document."); }
        });
    }
}
