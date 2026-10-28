package com.hisabdekhtechai.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.Arrays;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Read-only release probe. No DOM, ledger, identity, network calls or sensor access. */
public class MediaBridgeProbe extends Instrumentation {
    private boolean pickerTheme;
    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        pickerTheme = arguments != null && "true".equals(arguments.getString("picker_theme"));
        start();
    }
    private WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView found = findWebView(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }
    private String evaluate(WebView web, String script) throws Exception {
        CountDownLatch ready = new CountDownLatch(1);
        String[] value = new String[1];
        runOnMainSync(() -> web.evaluateJavascript(script, result -> { value[0] = result; ready.countDown(); }));
        if (!ready.await(10, TimeUnit.SECONDS)) throw new Exception("PROBE_SCRIPT_TIMEOUT");
        return value[0];
    }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            if (pickerTheme) {
                result = PickerThemeProbe.run(this);
                finish("PASS".equals(result.getString("picker_probe_status")) ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
                return;
            }
            Intent intent = new Intent().setClassName(getTargetContext().getPackageName(), "com.hisabdekhtechai.app.MainActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Activity activity = startActivitySync(intent);
            WebView[] holder = new WebView[1];
            runOnMainSync(() -> holder[0] = findWebView(activity.getWindow().getDecorView()));
            if (holder[0] == null) throw new Exception("PROBE_WEBVIEW_MISSING");
            WebView web = holder[0];
            String header = "null";
            for (int i = 0; i < 20; i++) {
                header = evaluate(web, "JSON.stringify((window.Capacitor?.PluginHeaders||[]).find(p=>p.name==='AIMediaAccess')||null)");
                if (!"null".equals(header) && !"\"null\"".equals(header)) break;
                Thread.sleep(250);
            }
            result.putString("media_header", header);
            result.putString("probe_start", evaluate(web, "(()=>{window.__hisabMediaProbe={stage:'pending'};const p=window.Capacitor?.Plugins?.AIMediaAccess;if(!p){window.__hisabMediaProbe={stage:'plugin_missing'};return 'missing'};Promise.resolve().then(()=>p.checkPermissions()).then(v=>window.__hisabMediaProbe={stage:'resolved',camera:v?.camera,microphone:v?.microphone},e=>window.__hisabMediaProbe={stage:'rejected',code:typeof e?.code==='string'?e.code:'UNKNOWN'});return 'started'})()"));
            String check = "";
            for (int i = 0; i < 30; i++) {
                check = evaluate(web, "JSON.stringify(window.__hisabMediaProbe)");
                if (!check.contains("pending")) break;
                Thread.sleep(100);
            }
            result.putString("permission_check", check);
            result.putString("capture_capabilities", evaluate(web, "JSON.stringify({secure:window.isSecureContext,audio:typeof navigator.mediaDevices?.getUserMedia==='function',recorder:typeof MediaRecorder==='function'})"));
            // A real-device regression must fail if the bridge rejects, hangs or
            // omits either state. It must never manufacture a permission grant.
            Object decoded = new JSONTokener(check).nextValue();
            JSONObject permissions = new JSONObject(decoded instanceof String ? (String) decoded : check);
            java.util.List<String> states = Arrays.asList("prompt", "prompt-with-rationale", "denied", "granted");
            boolean valid = "resolved".equals(permissions.optString("stage"))
                && states.contains(permissions.optString("camera")) && states.contains(permissions.optString("microphone"));
            result.putString("probe_status", valid ? "PASS" : "FAIL");
            finish(valid ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
        } catch (Exception failure) {
            // Class label only; never emit an exception message with arbitrary app data.
            result.putString("probe_error", failure.getClass().getSimpleName());
            finish(Activity.RESULT_CANCELED, result);
        }
    }
}
