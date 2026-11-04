package com.hisabdekhtechai.app;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

/** Dedicated local-only renderer. No file, network, JavaScript or ledger access. */
@CapacitorPlugin(name = "ReportPrint")
public class ReportPrintPlugin extends Plugin {
    private WebView renderer;
    @PluginMethod public void open(PluginCall call) {
        String html = call.getString("html");
        if (html == null || html.getBytes(StandardCharsets.UTF_8).length > 2 * 1024 * 1024) { call.reject("REPORT_TOO_LARGE"); return; }
        getActivity().runOnUiThread(() -> {
            if (renderer != null) { call.reject("REPORT_PRINT_BUSY"); return; }
            try {
                renderer = new WebView(getActivity());
                renderer.getSettings().setJavaScriptEnabled(false);
                renderer.getSettings().setAllowFileAccess(false);
                renderer.getSettings().setAllowContentAccess(false);
                renderer.getSettings().setBlockNetworkLoads(true);
                final WebView current = renderer;
                final boolean[] loaded = {false};
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    if (!loaded[0] && renderer == current) { releaseRenderer(); call.reject("REPORT_PRINT_UNAVAILABLE"); }
                }, 15000);
                renderer.setWebViewClient(new WebViewClient() {
                    private boolean opened = false;
                    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
                    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                        if (request.getUrl().toString().startsWith("data:font/woff2;base64,")) return null;
                        return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
                    }
                    @Override public void onPageFinished(WebView view, String url) {
                        if (opened) return; opened = true; loaded[0] = true;
                                if (renderer != view) return;
                                try {
                                    PrintManager manager = (PrintManager)getActivity().getSystemService(Context.PRINT_SERVICE);
                                    if (manager == null) throw new IllegalStateException();
                                    String name = call.getString("name", "Hisab financial report").replaceAll("[\\p{Cntrl}]", " ");
                                    PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(name);
                                    manager.print(name, new PrintDocumentAdapter() {
                                        @Override public void onStart() { adapter.onStart(); }
                                        @Override public void onLayout(PrintAttributes oldAttributes, PrintAttributes attributes, CancellationSignal signal, LayoutResultCallback callback, Bundle extras) { adapter.onLayout(oldAttributes, attributes, signal, callback, extras); }
                                        @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor destination, CancellationSignal signal, WriteResultCallback callback) { adapter.onWrite(pages, destination, signal, callback); }
                                        @Override public void onFinish() { try { adapter.onFinish(); } finally { if (renderer == view) releaseRenderer(); } }
                                    }, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                                    call.resolve();
                                } catch (Exception error) { releaseRenderer(); call.reject("REPORT_PRINT_UNAVAILABLE"); }
                    }
                });
                renderer.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
            } catch (Exception error) { releaseRenderer(); call.reject("REPORT_PRINT_UNAVAILABLE"); }
        });
    }
    private void releaseRenderer() { if (renderer != null) { renderer.destroy(); renderer = null; } }
    @Override protected void handleOnDestroy() { getActivity().runOnUiThread(this::releaseRenderer); super.handleOnDestroy(); }
}
