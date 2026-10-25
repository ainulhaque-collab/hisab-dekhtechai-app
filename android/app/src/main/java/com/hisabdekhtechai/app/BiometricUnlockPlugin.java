package com.hisabdekhtechai.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/** Device-local enrollment. No biometric data or keys cross the JS bridge or Drive. */
@CapacitorPlugin(name = "BiometricUnlock")
public class BiometricUnlockPlugin extends Plugin {
    private static final String KEY = "hisab.biometric.unlock.v1";
    private BiometricPrompt prompt;
    private PluginCall activeCall;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs() { return getContext().getSharedPreferences("hisab_unlock", Context.MODE_PRIVATE); }
    private int capability() { return BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG); }

    @PluginMethod public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", capability() == BiometricManager.BIOMETRIC_SUCCESS);
        result.put("enabled", prefs().getBoolean("enabled", false));
        result.put("statusCode", capability());
        result.put("authenticator", "BIOMETRIC_STRONG");
        call.resolve(result);
    }

    @PluginMethod public void authenticate(PluginCall call) { start(call, false); }
    @PluginMethod public void enable(PluginCall call) { start(call, true); }
    @PluginMethod public void disable(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            prefs().edit().putBoolean("enabled", false).commit();
            try { KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null); ks.deleteEntry(KEY); }
            catch (Exception ignored) { }
            call.resolve();
        });
    }

    private void start(PluginCall call, boolean enabling) {
        getActivity().runOnUiThread(() -> {
            if (activeCall != null) { call.reject("Authentication already in progress."); return; }
            if (capability() != BiometricManager.BIOMETRIC_SUCCESS || (!enabling && !prefs().getBoolean("enabled", false))) {
                call.reject("Secure biometrics unavailable. Use your App PIN.", "UNAVAILABLE"); return;
            }
            try {
                KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
                if (enabling) {
                    KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                    generator.init(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setUserAuthenticationRequired(true).setUserAuthenticationValidityDurationSeconds(-1)
                        .setInvalidatedByBiometricEnrollment(true).build());
                    generator.generateKey();
                }
                SecretKey key = (SecretKey) ks.getKey(KEY, null);
                if (key == null) throw new IllegalStateException("Enrollment key missing");
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key);
                activeCall = call;
                prompt = new BiometricPrompt(getActivity(), ContextCompat.getMainExecutor(getContext()), new BiometricPrompt.AuthenticationCallback() {
                    @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        if (activeCall != call) return;
                        try {
                            result.getCryptoObject().getCipher().doFinal(new byte[32]);
                            if (enabling && !prefs().edit().putBoolean("enabled", true).commit()) throw new IllegalStateException("Cannot save biometric setting");
                            activeCall = null; handler.removeCallbacksAndMessages(null);
                            JSObject response = new JSObject(); response.put("authenticated", true); call.resolve(response);
                        } catch (Exception e) { finishError(call, "Biometric key invalid. Use App PIN and enable biometrics again."); }
                    }
                    @Override public void onAuthenticationError(int code, CharSequence message) { finishError(call, "Authentication cancelled or unavailable. Use App PIN."); }
                    // Rejected samples remain in the OS prompt. They never unlock the app.
                });
                prompt.authenticate(new BiometricPrompt.PromptInfo.Builder().setTitle("Unlock Hisab DekhteChai")
                    .setSubtitle("Use an enrolled secure fingerprint or face")
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setNegativeButtonText("Use App PIN").build(), new BiometricPrompt.CryptoObject(cipher));
                handler.postDelayed(() -> { if (activeCall == call) { prompt.cancelAuthentication(); finishError(call, "Authentication timed out. Use App PIN."); } }, 60_000);
            } catch (Exception e) {
                prefs().edit().putBoolean("enabled", false).commit();
                call.reject("Biometric enrollment changed or key unavailable. Unlock with App PIN and enable biometrics again.", "ENROLLMENT_CHANGED");
            }
        });
    }

    private void finishError(PluginCall call, String message) {
        if (activeCall != call) return;
        activeCall = null; handler.removeCallbacksAndMessages(null); call.reject(message, "AUTH_FAILED");
    }
    @Override protected void handleOnStop() {
        if (prompt != null) prompt.cancelAuthentication();
        if (activeCall != null) finishError(activeCall, "App backgrounded. Authenticate again.");
    }
}
