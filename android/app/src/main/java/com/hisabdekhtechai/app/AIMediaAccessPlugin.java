package com.hisabdekhtechai.app;

import android.Manifest;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.LinkedHashSet;
import java.util.Set;

/** Concrete bridge methods/callbacks are retained in minified signed builds. Never opens sensors. */
@CapacitorPlugin(name = "AIMediaAccess", permissions = {
    @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class AIMediaAccessPlugin extends Plugin {
    @Override @PluginMethod public void checkPermissions(PluginCall call) {
        resolveMediaPermissions(call);
    }

    @Override @PluginMethod public void requestPermissions(PluginCall call) {
        try {
            JSArray supplied = call.getArray("permissions");
            Set<String> missing = new LinkedHashSet<>();
            if (supplied == null) supplied = new JSArray(new String[] { "camera", "microphone" });
            for (int index = 0; index < supplied.length(); index++) {
                String alias = supplied.getString(index);
                if (!alias.equals("camera") && !alias.equals("microphone")) {
                    call.reject("Unsupported media permission", "AI_MEDIA_PERMISSION_UNAVAILABLE"); return;
                }
                PermissionState state = getPermissionState(alias);
                if (state == null) { call.reject("Media permission unavailable", "AI_MEDIA_PERMISSION_UNAVAILABLE"); return; }
                if (state != PermissionState.GRANTED) missing.add(alias);
            }
            if (missing.isEmpty()) resolveMediaPermissions(call);
            else requestPermissionForAliases(missing.toArray(new String[0]), call, "mediaPermissionResult");
        } catch (Exception ignored) {
            call.reject("Media permission unavailable", "AI_MEDIA_PERMISSION_UNAVAILABLE");
        }
    }

    @PermissionCallback private void mediaPermissionResult(PluginCall call) {
        if (call != null) resolveMediaPermissions(call);
    }

    private void resolveMediaPermissions(PluginCall call) {
        PermissionState camera = getPermissionState("camera");
        PermissionState microphone = getPermissionState("microphone");
        if (camera == null || microphone == null) {
            call.reject("Media permission unavailable", "AI_MEDIA_PERMISSION_UNAVAILABLE"); return;
        }
        // Fixed labels + OS states only: no audio, identity, tokens or ledger data.
        Log.i("HisabMedia", "camera=" + camera + " microphone=" + microphone);
        JSObject result = new JSObject();
        result.put("camera", camera.toString());
        result.put("microphone", microphone.toString());
        call.resolve(result);
    }
}
