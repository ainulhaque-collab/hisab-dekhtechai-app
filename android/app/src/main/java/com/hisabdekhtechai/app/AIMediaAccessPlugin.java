package com.hisabdekhtechai.app;

import android.Manifest;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** Uses Capacitor's built-in permission methods; never opens a sensor by itself. */
@CapacitorPlugin(name = "AIMediaAccess", permissions = {
    @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class AIMediaAccessPlugin extends Plugin {}
