package com.hisabdekhtechai.app;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import android.os.Bundle;
import android.util.Log;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.common.api.ApiException;
import java.util.Arrays;

public class MainActivity extends BridgeActivity {
    private PluginCall pendingAuthorization;
    private final ActivityResultLauncher<IntentSenderRequest> driveConsent = registerForActivityResult(
        new ActivityResultContracts.StartIntentSenderForResult(), result -> {
            PluginCall call = pendingAuthorization;
            pendingAuthorization = null;
            if (call == null) return;
            try {
                finishAuthorization(call, Identity.getAuthorizationClient(this)
                    .getAuthorizationResultFromIntent(result.getData()));
            } catch (Exception e) { rejectAuthorization(call, e, "consent_result"); }
        });

    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeGoogleDrivePlugin.class);
        registerPlugin(BiometricUnlockPlugin.class);
        registerPlugin(BackupFilesPlugin.class);
        registerPlugin(AIMediaAccessPlugin.class);
        registerPlugin(ReportPrintPlugin.class);
        registerPlugin(CloudSessionVaultPlugin.class);
        registerPlugin(DeviceAppearancePlugin.class);
        super.onCreate(savedInstanceState);
        Log.i("HisabAuth", "Google plugin registered=" + (getBridge().getPlugin("NativeGoogleDrive") != null));
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                getBridge().getWebView().evaluateJavascript(
                    "window.dispatchEvent(new Event('hisab-back',{cancelable:true}))", result -> {
                        if (!"false".equals(result)) {
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                            setEnabled(true);
                        }
                    });
            }
        });
    }

    public void authorizeDrive(PluginCall call) {
        Log.i("HisabAuth", "authorize requested interactive=" + call.getBoolean("interactive", false));
        if (pendingAuthorization != null) { call.reject("Authorization already in progress."); return; }
        pendingAuthorization = call;
        String invalid = call.getString("invalidToken");
        if (invalid != null && !invalid.isEmpty()) {
            Identity.getAuthorizationClient(this).clearToken(ClearTokenRequest.builder().setToken(invalid).build())
                .addOnSuccessListener(unused -> requestDrive(call))
                .addOnFailureListener(e -> rejectAuthorization(call, e, "clear_token"));
        } else requestDrive(call);
    }

    private void requestDrive(PluginCall call) {
        try {
        AuthorizationRequest request = AuthorizationRequest.builder().setRequestedScopes(Arrays.asList(
            new Scope("https://www.googleapis.com/auth/drive.appdata"),
            new Scope("openid"), new Scope("https://www.googleapis.com/auth/userinfo.email"),
            new Scope("https://www.googleapis.com/auth/userinfo.profile"))).build();
        Identity.getAuthorizationClient(this).authorize(request).addOnSuccessListener(result -> {
            if (result.hasResolution()) {
                Log.i("HisabAuth", "consent required");
                if (!Boolean.TRUE.equals(call.getBoolean("interactive", false))) {
                    pendingAuthorization = null; call.reject("Reconnect Google Drive to grant access.", "AUTH_REQUIRED"); return;
                }
                driveConsent.launch(new IntentSenderRequest.Builder(result.getPendingIntent().getIntentSender()).build());
            } else { pendingAuthorization = null; finishAuthorization(call, result); }
        }).addOnFailureListener(e -> rejectAuthorization(call, e, "authorize"));
        } catch (Exception e) { rejectAuthorization(call, e, "request_start"); }
    }

    private void rejectAuthorization(PluginCall call, Exception error, String stage) {
        pendingAuthorization = null;
        int status = error instanceof ApiException ? ((ApiException) error).getStatusCode() : -1;
        // Fixed stage labels and numeric status only: never log account data or tokens.
        Log.w("HisabAuth", "authorization failed stage=" + stage + " status=" + status);
        String code = status == 10 ? "GOOGLE_ANDROID_CONFIG" : "AUTH_REQUIRED";
        String message = status == 7 ? "Google network authorization failed. Check internet connectivity."
            : "Google Drive authorization failed. Verify this build's OAuth package and signing certificate.";
        call.reject(message, code);
    }

    private void finishAuthorization(PluginCall call, AuthorizationResult result) {
        Log.i("HisabAuth", "authorization completed; checking Drive permission");
        if (result.getAccessToken() == null || !result.getGrantedScopes().contains("https://www.googleapis.com/auth/drive.appdata")) {
            call.reject("Private Drive app storage permission is required.", "AUTH_REQUIRED"); return;
        }
        JSObject response = new JSObject();
        response.put("accessToken", result.getAccessToken());
        call.resolve(response);
    }
    @Override public void onStop() {
        if (getBridge() != null) getBridge().triggerWindowJSEvent("hisab-background");
        super.onStop();
    }
    @Override public void onResume() {
        super.onResume();
        if (getBridge() != null) getBridge().triggerWindowJSEvent("hisab-foreground");
    }
}
