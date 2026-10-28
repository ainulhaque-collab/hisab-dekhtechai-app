package com.hisabdekhtechai.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** The real production DOM calendar in a new, network-blocked synthetic WebView.
 * Never evaluates the user's app WebView or reads its records, storage or identity. */
public final class DOMCalendarProbe {
    private static String evaluate(Instrumentation probe, WebView web, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        String[] value = new String[1];
        probe.runOnMainSync(() -> web.evaluateJavascript(script, result -> { value[0] = result; done.countDown(); }));
        if (!done.await(10, TimeUnit.SECONDS)) throw new Exception("DOM_PROBE_TIMEOUT");
        return value[0];
    }
    private static void expect(Instrumentation probe, WebView web, String script) throws Exception {
        for (int i = 0; i < 40; i++) {
            if ("true".equals(evaluate(probe, web, script))) return;
            Thread.sleep(100);
        }
        throw new Exception("DOM_PROBE_ASSERTION_FAILED");
    }
    private static void screenshot(Instrumentation probe, WebView web, File target) throws Exception {
        probe.waitForIdleSync();
        Thread.sleep(300);
        int[] bounds = new int[4];
        probe.runOnMainSync(() -> {
            int[] xy = new int[2]; web.getLocationOnScreen(xy);
            bounds[0] = xy[0]; bounds[1] = xy[1]; bounds[2] = web.getWidth(); bounds[3] = web.getHeight();
        });
        Bitmap screen = probe.getUiAutomation().takeScreenshot();
        if (screen == null) throw new Exception("DOM_PROBE_IMAGE_UNAVAILABLE");
        // Crop only the opaque synthetic WebView; the real app is fully covered.
        Bitmap image = Bitmap.createBitmap(screen, bounds[0], bounds[1], bounds[2], bounds[3]);
        try (FileOutputStream stream = new FileOutputStream(target)) { image.compress(Bitmap.CompressFormat.PNG, 100, stream); }
        finally { if (image != screen) image.recycle(); screen.recycle(); }
    }
    public static Bundle run(Instrumentation probe) throws Exception {
        Bundle result = new Bundle();
        String html;
        try (java.io.InputStream stream = probe.getContext().getAssets().open("calendar-probe.html")) {
            html = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
        Activity activity = probe.startActivitySync(new Intent().setClassName(probe.getTargetContext().getPackageName(),
            "com.hisabdekhtechai.app.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        FrameLayout cover = new FrameLayout(activity);
        WebView[] holder = new WebView[1];
        File output = new File(probe.getTargetContext().getExternalCacheDir(), "synthetic-dom-calendar-probe");
        if (!output.isDirectory() && !output.mkdirs()) throw new Exception("DOM_PROBE_OUTPUT_UNAVAILABLE");
        try {
            probe.runOnMainSync(() -> {
                cover.setBackgroundColor(Color.WHITE);
                WebView web = new WebView(activity);
                holder[0] = web;
                web.setBackgroundColor(Color.WHITE);
                web.getSettings().setJavaScriptEnabled(true);
                web.getSettings().setBlockNetworkLoads(true);
                cover.addView(web, new ViewGroup.LayoutParams(-1, -1));
                activity.addContentView(cover, new ViewGroup.LayoutParams(-1, -1));
                web.loadDataWithBaseURL("https://localhost/__synthetic_calendar_probe", html, "text/html", "UTF-8", null);
            });
            WebView web = holder[0];
            expect(probe, web, "document.documentElement.dataset.calendarProbeReady==='true'");
            evaluate(probe, web, "document.getElementById('probe-date').click()");
            expect(probe, web, "!!document.querySelector('[data-app-calendar]')");
            expect(probe, web, "document.querySelectorAll('input[type=date]').length===0 && document.querySelectorAll('[data-calendar-date]').length===31 && document.activeElement.tagName!=='INPUT'");
            screenshot(probe, web, new File(output, "calendar-en.png"));
            evaluate(probe, web, "document.querySelector('[data-calendar-next]').click()");
            expect(probe, web, "!!document.querySelector('[data-calendar-date=\"2026-11-15\"]')");
            evaluate(probe, web, "document.querySelector('[data-calendar-next]').click()");
            expect(probe, web, "!!document.querySelector('[data-calendar-date=\"2026-12-15\"]')");
            evaluate(probe, web, "document.querySelector('[data-calendar-date=\"2026-12-15\"]').click()");
            expect(probe, web, "document.getElementById('probe-date-value').textContent==='2026-12-15' && !document.querySelector('[data-app-calendar]')");
            result.putBoolean("english_selection", true);
            evaluate(probe, web, "document.getElementById('probe-language-bn').click()");
            expect(probe, web, "document.getElementById('probe-date').getAttribute('aria-label').includes('পরীক্ষার')");
            evaluate(probe, web, "document.getElementById('probe-date').click()");
            expect(probe, web, "!!document.querySelector('[data-app-calendar]') && document.querySelector('[data-calendar-date=\"2026-12-15\"]').textContent.includes('১৫')");
            screenshot(probe, web, new File(output, "calendar-bn.png"));
            evaluate(probe, web, "document.querySelector('[data-calendar-date=\"2026-12-16\"]').click()");
            expect(probe, web, "document.getElementById('probe-date-value').textContent==='2026-12-16'");
            result.putBoolean("bengali_selection", true);
            evaluate(probe, web, "document.getElementById('probe-date').click()");
            expect(probe, web, "!!document.querySelector('[data-app-calendar]')");
            evaluate(probe, web, "document.querySelector('[data-calendar-cancel]').click()");
            expect(probe, web, "document.getElementById('probe-date-value').textContent==='2026-12-16' && !document.querySelector('[data-app-calendar]')");
            result.putBoolean("cancel_retains_value", true);
            evaluate(probe, web, "document.getElementById('probe-date').click()");
            expect(probe, web, "!!document.querySelector('[data-app-calendar]')");
            evaluate(probe, web, "document.querySelector('[data-calendar-clear]').click()");
            expect(probe, web, "document.getElementById('probe-date-value').textContent==='' && !document.querySelector('[data-app-calendar]')");
            result.putBoolean("clear_date", true);
            result.putString("dom_calendar_probe_status", "PASS");
            return result;
        } finally {
            probe.runOnMainSync(() -> {
                if (holder[0] != null) { cover.removeView(holder[0]); holder[0].destroy(); }
                if (cover.getParent() instanceof ViewGroup) ((ViewGroup) cover.getParent()).removeView(cover);
            });
        }
    }
}
