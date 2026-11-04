# Capacitor libraries supply their bridge/annotation consumer rules.
# Keep the application plugins that are registered directly in MainActivity.
-keep class com.hisabdekhtechai.app.NativeGoogleDrivePlugin { *; }
-keep class com.hisabdekhtechai.app.BackupFilesPlugin { *; }
-keep class com.hisabdekhtechai.app.BiometricUnlockPlugin { *; }
-keep class com.hisabdekhtechai.app.AIMediaAccessPlugin { *; }
-keep class com.hisabdekhtechai.app.CloudSessionVaultPlugin { *; }
# PluginHandle stores runtime annotation instances used by permission aliases.
# Keeping only application plugins left its annotation field/getter optimized to
# null in the signed release (checkPermissions returned an empty map). Preserve
# this small reflection boundary, including nested permission/default metadata.
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault
-keep class com.getcapacitor.PluginHandle { *; }
-keep @interface com.getcapacitor.annotation.** { *; }
