# Capacitor libraries supply their bridge/annotation consumer rules.
# Keep the application plugins that are registered directly in MainActivity.
-keep class com.hisabdekhtechai.app.NativeGoogleDrivePlugin { *; }
-keep class com.hisabdekhtechai.app.BackupFilesPlugin { *; }
-keep class com.hisabdekhtechai.app.BiometricUnlockPlugin { *; }
