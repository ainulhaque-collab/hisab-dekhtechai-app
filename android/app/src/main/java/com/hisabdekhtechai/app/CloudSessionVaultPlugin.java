package com.hisabdekhtechai.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Device-local auth vault. No secrets/keys logged, exported, backed up or sent to Drive. */
@CapacitorPlugin(name = "CloudSessionVault")
public class CloudSessionVaultPlugin extends Plugin {
    private static final String ALIAS = "hisab.cloud.credentials.v1";
    private SharedPreferences prefs() { return getContext().getSharedPreferences("hisab_cloud_credentials_v1", Context.MODE_PRIVATE); }
    private String checkedKey(PluginCall call, String field) {
        String key = call.getString(field);
        if (key == null || key.length() > 240 || !key.matches("hisab-cloud-auth-v1-[a-z]{20}(-[A-Za-z0-9_-]+)?")) {
            throw new IllegalArgumentException();
        }
        return key;
    }
    private SecretKey secret(boolean create) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        SecretKey key = (SecretKey) ks.getKey(ALIAS, null);
        if (key != null || !create) return key;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    @PluginMethod public synchronized void get(PluginCall call) {
        try {
            String name = checkedKey(call, "key"), raw = prefs().getString(name, null);
            JSObject result = new JSObject();
            if (raw == null) { result.put("value", JSONObject.NULL); call.resolve(result); return; }
            if (raw.length() > 100000) throw new IllegalStateException();
            JSONObject record = new JSONObject(raw);
            if (record.getInt("version") != 1) throw new IllegalStateException();
            byte[] iv = Base64.decode(record.getString("iv"), Base64.NO_WRAP);
            if (iv.length != 12) throw new IllegalStateException();
            SecretKey key = secret(false);
            if (key == null) throw new IllegalStateException();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            cipher.updateAAD((getContext().getPackageName() + ":" + name).getBytes(StandardCharsets.UTF_8));
            byte[] plaintext = cipher.doFinal(Base64.decode(record.getString("ciphertext"), Base64.NO_WRAP));
            result.put("value", new String(plaintext, StandardCharsets.UTF_8)); call.resolve(result);
        } catch (Exception ignored) { call.reject("Secure session storage could not be read.", "CLOUD_STORAGE_INVALID"); }
    }
    @PluginMethod public synchronized void set(PluginCall call) {
        try {
            String name = checkedKey(call, "key"), value = call.getString("value");
            if (value == null || value.getBytes(StandardCharsets.UTF_8).length > 65536) throw new IllegalArgumentException();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secret(true));
            cipher.updateAAD((getContext().getPackageName() + ":" + name).getBytes(StandardCharsets.UTF_8));
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            JSONObject record = new JSONObject(); record.put("version", 1);
            record.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
            record.put("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP));
            if (!prefs().edit().putString(name, record.toString()).commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception ignored) { call.reject("Secure session storage is unavailable.", "CLOUD_STORAGE_UNAVAILABLE"); }
    }
    @PluginMethod public synchronized void remove(PluginCall call) {
        try {
            if (!prefs().edit().remove(checkedKey(call, "key")).commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception ignored) { call.reject("Secure session could not be removed.", "CLOUD_STORAGE_UNAVAILABLE"); }
    }
    @PluginMethod public synchronized void clear(PluginCall call) {
        try {
            String prefix = checkedKey(call, "prefix");
            if (!prefix.matches("hisab-cloud-auth-v1-[a-z]{20}")) throw new IllegalArgumentException();
            SharedPreferences.Editor edit = prefs().edit();
            for (String name : prefs().getAll().keySet()) {
                if (name.equals(prefix) || name.startsWith(prefix + "-")) edit.remove(name);
            }
            if (!edit.commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception ignored) { call.reject("Secure session could not be cleared.", "CLOUD_STORAGE_UNAVAILABLE"); }
    }
}
