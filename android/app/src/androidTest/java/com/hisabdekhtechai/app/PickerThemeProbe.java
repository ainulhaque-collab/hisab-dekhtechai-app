package com.hisabdekhtechai.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.Instrumentation;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.content.res.Configuration;
import android.content.res.TypedArray;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.os.Bundle;
import android.view.ContextThemeWrapper;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TimePicker;
import java.io.File;
import java.io.FileOutputStream;

/** Native-only synthetic picker test. No WebView DOM, records, account or sensor access. */
public final class PickerThemeProbe {
    private static double luminance(int color) {
        double sum = 0;
        int[] channels = { Color.red(color), Color.green(color), Color.blue(color) };
        double[] weights = { 0.2126, 0.7152, 0.0722 };
        for (int i = 0; i < channels.length; i++) {
            double value = channels[i] / 255.0;
            sum += weights[i] * (value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
        }
        return sum;
    }

    private static TimePicker findTime(View view) {
        if (view instanceof TimePicker) return (TimePicker) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                TimePicker found = findTime(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    public static Bundle run(Instrumentation probe) throws Exception {
        Bundle result = new Bundle();
        Activity activity = probe.startActivitySync(new Intent().setClassName(
            probe.getTargetContext().getPackageName(), "com.hisabdekhtechai.app.MainActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        FrameLayout cover = new FrameLayout(activity);
        AlertDialog[] shown = new AlertDialog[1];
        File output = new File(probe.getTargetContext().getExternalCacheDir(), "synthetic-picker-probe");
        if (!output.isDirectory() && !output.mkdirs()) throw new Exception("PROBE_OUTPUT_UNAVAILABLE");
        boolean[] passed = { true };
        try {
            probe.runOnMainSync(() -> {
                cover.setBackgroundColor(Color.WHITE);
                activity.addContentView(cover, new ViewGroup.LayoutParams(-1, -1));
            });
            for (boolean night : new boolean[] { false, true }) {
                for (boolean time : new boolean[] { false, true }) {
                    String label = (night ? "night_" : "day_") + (time ? "time" : "date");
                    int[] selected = { -1, -1, -1 };
                    probe.runOnMainSync(() -> {
                        Configuration config = new Configuration();
                        config.uiMode = night ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO;
                        int theme = activity.getResources().getIdentifier("AppTheme", "style", activity.getPackageName());
                        ContextThemeWrapper context = new ContextThemeWrapper(activity, theme);
                        context.applyOverrideConfiguration(config);
                        if (time) {
                            shown[0] = new TimePickerDialog(context, (picker, hour, minute) -> {
                                selected[0] = hour; selected[1] = minute;
                            }, 12, 10, true);
                        } else {
                            shown[0] = new DatePickerDialog(context, (picker, year, month, day) -> {
                                selected[0] = year; selected[1] = month; selected[2] = day;
                            }, 2026, 9, 28);
                        }
                        shown[0].show();
                    });
                    probe.waitForIdleSync();
                    Thread.sleep(300);
                    probe.runOnMainSync(() -> {
                        TypedArray colors = shown[0].getContext().obtainStyledAttributes(new int[] {
                            android.R.attr.textColorPrimary, android.R.attr.colorBackground });
                        int foreground = colors.getColorStateList(0).getDefaultColor();
                        int background = colors.getColor(1, Color.TRANSPARENT);
                        colors.recycle();
                        double f = luminance(foreground), b = luminance(background);
                        double contrast = (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
                        result.putDouble(label + "_text_contrast", contrast);
                        passed[0] &= Color.alpha(foreground) == 255 && Color.alpha(background) == 255 && contrast >= 4.5;
                        // Draw only this synthetic dialog, never the underlying activity or screen.
                        View decor = shown[0].getWindow().getDecorView();
                        Bitmap image = Bitmap.createBitmap(decor.getWidth(), decor.getHeight(), Bitmap.Config.ARGB_8888);
                        decor.draw(new Canvas(image));
                        try (FileOutputStream stream = new FileOutputStream(new File(output, label + ".png"))) {
                            image.compress(Bitmap.CompressFormat.PNG, 100, stream);
                        } catch (Exception failure) { throw new IllegalStateException("PROBE_IMAGE_WRITE_FAILED"); }
                        finally { image.recycle(); }
                        if (time) {
                            TimePicker picker = findTime(decor);
                            if (picker == null) throw new IllegalStateException("PROBE_TIME_PICKER_MISSING");
                            picker.setHour(14); picker.setMinute(30);
                        } else {
                            ((DatePickerDialog) shown[0]).updateDate(2026, 11, 15);
                        }
                        shown[0].getButton(AlertDialog.BUTTON_POSITIVE).performClick();
                    });
                    boolean callback = time ? selected[0] == 14 && selected[1] == 30
                        : selected[0] == 2026 && selected[1] == 11 && selected[2] == 15;
                    result.putBoolean(label + "_selection_callback", callback);
                    passed[0] &= callback;
                }
            }
            result.putString("picker_probe_status", passed[0] ? "PASS" : "FAIL");
            return result;
        } finally {
            probe.runOnMainSync(() -> {
                if (shown[0] != null) shown[0].dismiss();
                if (cover.getParent() instanceof ViewGroup) ((ViewGroup) cover.getParent()).removeView(cover);
            });
        }
    }
}
