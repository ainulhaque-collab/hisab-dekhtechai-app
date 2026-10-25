package com.hisabdekhtechai.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeGoogleDrive")
public class NativeGoogleDrivePlugin extends Plugin {
    @PluginMethod
    public void authorize(PluginCall call) {
        getActivity().runOnUiThread(() -> ((MainActivity) getActivity()).authorizeDrive(call));
    }
}
