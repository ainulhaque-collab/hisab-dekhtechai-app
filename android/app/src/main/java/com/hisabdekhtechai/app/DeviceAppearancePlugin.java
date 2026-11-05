package com.hisabdekhtechai.app;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Window;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Display-only bridge. No permissions, storage, network or customer-data access. */
@CapacitorPlugin(name = "DeviceAppearance")
public class DeviceAppearancePlugin extends Plugin {
    @PluginMethod public void setTheme(PluginCall call) {
        Boolean dark = call.getBoolean("dark");
        if (dark == null) { call.reject("APPEARANCE_INVALID"); return; }
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            int color = Color.parseColor(dark ? "#101121" : "#F7F6FC");
            WindowInsetsControllerCompat bars = new WindowInsetsControllerCompat(window, window.getDecorView());
            bars.setAppearanceLightStatusBars(!dark);
            bars.setAppearanceLightNavigationBars(!dark);
            // Android 15+ may enforce transparent bars; the window/WebView surface
            // also follows the selected theme, while insets remain untouched.
            window.setStatusBarColor(color);
            window.setNavigationBarColor(color);
            window.setBackgroundDrawable(new ColorDrawable(color));
            getBridge().getWebView().setBackgroundColor(color);
            call.resolve();
        });
    }
}
