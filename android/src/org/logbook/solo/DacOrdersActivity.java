package org.logbook.solo;

import android.app.Activity;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Read-only order scan. The remote WebView has no JavascriptInterface, file
 * access or access to the logbook. Only a bounded JSON result is passed back.
 * Every script execution/result is bound to the current HTTPS DAC navigation.
 */
public class DacOrdersActivity extends Activity {
    static final String EXTRA_SCRIPT = "ordersScript";
    static final String RESULT_FILE = "dac-orders.json";
    private static final String ACCOUNT = "https://www.diamondartclub.com/pages/account";
    private static final String READ_STATUS = "(function(){var r=window.__dazzleOrders;return r?JSON.stringify({done:r.done,waiting:r.waiting,progress:r.progress}):null;})()";
    private WebView web;
    private TextView status;
    private Button retry;
    private String script;
    private int navigation;
    private boolean finished, polling;
    private long started;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        script = getIntent().getStringExtra(EXTRA_SCRIPT);
        if (script == null || script.length() > 64 * 1024) { finish(); return; }
        // Never let a previous interrupted scan be mistaken for this one.
        new File(new File(getFilesDir(), "media"), RESULT_FILE).delete();
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF1E1A17);
        status = new TextView(this);
        status.setTextColor(0xFFF3ECE3);
        status.setTextSize(14);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        status.setPadding(pad, pad, pad, pad);
        status.setText("Sign in to Diamond Art Club. Your orders will be read for review in Dazzle Diary.");
        root.addView(status);
        LinearLayout actions = new LinearLayout(this);
        Button cancel = new Button(this);
        cancel.setText("Cancel");
        cancel.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { onBackPressed(); }
        });
        actions.addView(cancel);
        retry = new Button(this);
        retry.setText("Read orders");
        retry.setEnabled(false);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (!isDac() || polling) return;
                web.evaluateJavascript("delete window.__dazzleOrders;", null);
                startScan();
            }
        });
        actions.addView(retry);
        root.addView(actions);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // Intentionally no addJavascriptInterface on a merchant page.
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return !"https".equals(r.getUrl().getScheme());
            }
            @Override public void onPageStarted(WebView v, String url, Bitmap icon) {
                navigation++;
                polling = false;
                retry.setEnabled(false);
                main.removeCallbacksAndMessages(null);
            }
            @Override public void onPageFinished(WebView v, String url) { startScan(); }
        });
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        web.loadUrl(ACCOUNT);
    }

    private boolean isDac() {
        if (web == null || web.getUrl() == null) return false;
        Uri u = Uri.parse(web.getUrl());
        return "https".equals(u.getScheme()) && ("www.diamondartclub.com".equals(u.getHost())
            || "diamondartclub.com".equals(u.getHost()));
    }

    private boolean current(int generation) { return !finished && generation == navigation && isDac(); }

    private void startScan() {
        if (finished || polling || !isDac()) return;
        polling = true;
        retry.setEnabled(false);
        started = SystemClock.uptimeMillis();
        web.evaluateJavascript(script, null);
        poll(navigation);
    }

    private void poll(final int generation) {
        main.postDelayed(new Runnable() { @Override public void run() {
            if (!current(generation)) return;
            if (SystemClock.uptimeMillis() - started > 5 * 60 * 1000) {
                fail("The order scan took too long. Please try again."); return;
            }
            web.evaluateJavascript(READ_STATUS, new ValueCallback<String>() {
                @Override public void onReceiveValue(String value) {
                    if (!current(generation)) return;
                    try {
                        String text = unquote(value);
                        if (text != null && text.length() < 2048 && !"null".equals(text)) {
                            JSONObject result = new JSONObject(text);
                            if (result.optBoolean("waiting")) {
                                polling = false;
                                retry.setEnabled(true);
                                status.setText("Sign in to DAC to read your orders. If sign-in has finished, tap Read orders.");
                                return;
                            }
                            if (result.optBoolean("done")) { readResult(generation); return; }
                            String progress = result.optString("progress", "Reading your orders…");
                            status.setText(progress.substring(0, Math.min(160, progress.length())));
                        }
                    } catch (Exception ignored) { /* the page may still be loading */ }
                    poll(generation);
                }
            });
        } }, 750);
    }

    private void readResult(final int generation) {
        web.evaluateJavascript("JSON.stringify(window.__dazzleOrders || null)", new ValueCallback<String>() {
            @Override public void onReceiveValue(String value) {
                if (!current(generation)) return;
                String text = unquote(value);
                if (text == null || text.length() > 12 * 1024 * 1024) {
                    fail("The order scan was too large or unreadable."); return;
                }
                deliver(text);
            }
        });
    }

    private void fail(String message) {
        try { deliver(new JSONObject().put("done", true).put("error", message).toString()); }
        catch (Exception e) { setResult(RESULT_CANCELED); finish(); }
    }

    private void deliver(String text) {
        finished = true;
        try {
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > 12 * 1024 * 1024) throw new IllegalArgumentException("scan too large");
            File dir = new File(getFilesDir(), "media");
            dir.mkdirs();
            try (FileOutputStream out = new FileOutputStream(new File(dir, RESULT_FILE))) { out.write(bytes); }
            setResult(RESULT_OK);
        } catch (Exception e) { setResult(RESULT_CANCELED); }
        finish();
    }

    private static String unquote(String value) {
        if (value == null) return null;
        try {
            Object decoded = new JSONTokener(value).nextValue();
            return decoded instanceof String ? (String) decoded : null;
        } catch (Exception e) { return null; }
    }

    @Override public void onBackPressed() {
        finished = true;
        setResult(RESULT_CANCELED);
        finish();
    }

    @Override protected void onDestroy() {
        finished = true;
        main.removeCallbacksAndMessages(null);
        if (web != null) { web.stopLoading(); web.destroy(); }
        super.onDestroy();
    }
}
