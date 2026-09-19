package org.logbook.solo;

import android.app.Activity;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Signs into a Diamond Art Club account, ticks "Already purchased this?" on the
 * product page of each kit you own, then reads their drill legends.
 *
 * A kit only unlocks its legend when it came from an order or that box was
 * ticked; adding it to DAC's logbook by hand does not count. So this presses
 * DAC's own button, on DAC's own page, as you would.
 *
 * Three steps, one page at a time:
 *   sign in  — you do this, on DAC's pages; nothing here sees the password
 *   mark     — each kit's product page gets the mark script (core/dacsync.js)
 *   legends  — DAC's account page gets the read-only legend script
 *
 * This screen is cut off from the app. Its WebView has NO JavascriptInterface:
 * nothing DAC loads can reach Dazzle Diary. Java only READS what the scripts
 * leave on the page, and the app treats that as untrusted.
 *
 * No lambdas: the app compiles against Android's own stubs, which cannot build
 * one. Anonymous classes instead.
 */
public class DacActivity extends Activity {

    static final String EXTRA_KITS = "kits";
    static final String EXTRA_MARK = "mark";
    static final String EXTRA_WATCH = "watch";
    static final String EXTRA_LEGENDS = "legends";
    static final String RESULT_FILE = "dac-sync.json";

    private static final String BASE = "https://www.diamondartclub.com";
    private static final String ACCOUNT = BASE + "/pages/account";
    private static final String CHECK =
        "(function(){var e=document.getElementById('logbook-customer-data');"
        + "return e?e.getAttribute('data-logged-in'):'none';})()";
    private static final String READ_LEGENDS = "JSON.stringify(window.__dd||null)";
    private static final long KIT_LIMIT_MS = 45000;

    private static final int SIGNIN = 0, MARK = 1, LEGENDS = 2;

    private WebView web;
    private TextView status;
    private JSONArray kits;
    private String markJs, watchJs, legendJs;
    private final JSONArray marks = new JSONArray();
    private int phase = SIGNIN;
    private int index;               // the kit being marked
    private int loads;               // product pages loaded for this kit
    private long kitStarted;
    private boolean legendsStarted;
    private boolean finished;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        try { kits = new JSONArray(getIntent().getStringExtra(EXTRA_KITS)); } catch (Exception e) { kits = null; }
        markJs = getIntent().getStringExtra(EXTRA_MARK);
        watchJs = getIntent().getStringExtra(EXTRA_WATCH);
        legendJs = getIntent().getStringExtra(EXTRA_LEGENDS);
        if (kits == null || kits.length() == 0 || markJs == null || watchJs == null || legendJs == null) {
            finish(); return;
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF1E1A17);

        status = new TextView(this);
        status.setTextColor(0xFFF3ECE3);
        status.setTextSize(14);
        status.setTypeface(Typeface.DEFAULT_BOLD);
        status.setGravity(Gravity.CENTER_VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        status.setPadding(pad, pad, pad, pad);
        say("Sign in to the Diamond Art Club account to use for drill colours.");
        root.addView(status, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // deliberately no addJavascriptInterface — see the class comment

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return !"https".equals(r.getUrl().getScheme());
            }
            @Override public void onPageFinished(WebView v, String url) { onPage(url); }
        });

        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        web.loadUrl(ACCOUNT);
    }

    private static boolean isDac(Uri u) {
        String h = u.getHost() == null ? "" : u.getHost();
        return h.equals("www.diamondartclub.com") || h.equals("diamondartclub.com");
    }

    private void onPage(String url) {
        if (finished) return;
        final Uri u = Uri.parse(url);
        if (!isDac(u)) return;
        final String path = u.getPath() == null ? "" : u.getPath();

        if (phase == MARK) {
            if (!path.contains("/products/")) return;
            /* The first page for a kit may press. Any later page for the SAME kit
               — a redirect, or a reload the press caused — only watches: a
               second press would un-mark it. */
            loads++;
            web.evaluateJavascript(loads == 1 ? markJs : watchJs, null);
            return;
        }

        web.evaluateJavascript(CHECK, new ValueCallback<String>() {
            @Override public void onReceiveValue(String value) {
                String signedIn = unquote(value);
                if ("true".equals(signedIn)) {
                    if (phase == SIGNIN) { phase = MARK; index = 0; openKit(); }
                    else if (phase == LEGENDS && !legendsStarted) startLegends();
                    return;
                }
                boolean account = path.startsWith("/account") && !path.startsWith("/account/login")
                    && !path.contains("register") && !path.contains("reset") && !path.contains("activate");
                if ("none".equals(signedIn) && account) web.loadUrl(ACCOUNT);
            }
        });
    }

    /* ------------------------------------------------------------ marking */

    private void openKit() {
        if (finished) return;
        if (index >= kits.length()) {
            phase = LEGENDS;
            say("Fetching the colour lists…");
            web.loadUrl(ACCOUNT);
            return;
        }
        JSONObject k = kits.optJSONObject(index);
        String handle = k == null ? "" : k.optString("handle", "");
        String variant = k == null ? "" : k.optString("variant", "");
        if (handle.isEmpty() || !variant.matches("\\d{1,20}")) { record("failed", null); return; }
        loads = 0;
        kitStarted = SystemClock.uptimeMillis();
        say("Kit " + (index + 1) + " of " + kits.length() + " · " + k.optString("name", ""));
        web.loadUrl(BASE + "/products/" + Uri.encode(handle) + "?variant=" + variant);
        pollMark(index);
    }

    private void pollMark(final int forKit) {
        main.postDelayed(new Runnable() { @Override public void run() {
            if (finished || phase != MARK || forKit != index) return;
            /* Each kit's own read (core/dacsync.js buildReadMark): it answers only
               on THAT kit's page, so the last kit's result, still showing while
               the next page loads, is never taken for this one. */
            JSONObject k = kits.optJSONObject(forKit);
            String read = k == null ? "" : k.optString("read", "");
            if (read.isEmpty()) { record("failed", null); return; }
            web.evaluateJavascript(read, new ValueCallback<String>() {
                @Override public void onReceiveValue(String value) {
                    if (finished || phase != MARK || forKit != index) return;
                    JSONObject ap = null;
                    try {
                        String text = unquote(value);
                        if (text != null && !"null".equals(text)) ap = new JSONObject(text);
                    } catch (Exception ignored) { ap = null; }
                    String state = ap == null ? null : ap.optString("state", null);
                    boolean done = state != null && !"working".equals(state);
                    if (done) { record(state, ap.optJSONObject("found")); return; }
                    if (SystemClock.uptimeMillis() - kitStarted > KIT_LIMIT_MS) { record("timeout", null); return; }
                    pollMark(forKit);
                }
            });
        } }, 700);
    }

    /** What happened on one kit's page; `found` is the page report, if any. */
    private void record(String state, JSONObject found) {
        JSONObject k = kits.optJSONObject(index);
        try {
            JSONObject m = new JSONObject()
                .put("variant", k == null ? "" : k.optString("variant", ""))
                .put("name", k == null ? "" : k.optString("name", ""))
                .put("state", state);
            if (found != null) m.put("found", found);
            marks.put(m);
        } catch (Exception ignored) { /* nothing to add */ }
        index++;
        openKit();
    }

    /* ------------------------------------------------------------ legends */

    private void startLegends() {
        legendsStarted = true;
        web.evaluateJavascript(legendJs, null);
        pollLegends();
    }

    private void pollLegends() {
        main.postDelayed(new Runnable() { @Override public void run() {
            if (finished) return;
            web.evaluateJavascript(READ_LEGENDS, new ValueCallback<String>() {
                @Override public void onReceiveValue(String value) {
                    try {
                        String text = unquote(value);
                        if (text != null && !"null".equals(text)) {
                            JSONObject dd = new JSONObject(text);
                            if (dd.optBoolean("done")) { deliver(dd); return; }
                            JSONObject p = dd.optJSONObject("progress");
                            if (p != null) say("Colour list " + Math.min(p.optInt("done") + 1, p.optInt("total"))
                                + " of " + p.optInt("total"));
                        }
                    } catch (Exception ignored) { /* not ready yet */ }
                    pollLegends();
                }
            });
        } }, 1000);
    }

    /** Hand the result to the app through a file, and go back. */
    private void deliver(JSONObject dd) {
        finished = true;
        try {
            JSONObject out = new JSONObject().put("marks", marks).put("dd", dd);
            File dir = new File(getFilesDir(), "media");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            FileOutputStream f = new FileOutputStream(new File(dir, RESULT_FILE));
            try { f.write(out.toString().getBytes(StandardCharsets.UTF_8)); } finally { f.close(); }
            setResult(RESULT_OK);
        } catch (Exception e) { setResult(RESULT_CANCELED); }
        finish();
    }

    private void say(final String text) {
        main.post(new Runnable() { @Override public void run() { status.setText(text); } });
    }

    /** evaluateJavascript hands back a JSON value: unwrap a string to its text. */
    private static String unquote(String json) {
        if (json == null) return null;
        try {
            Object v = new JSONTokener(json).nextValue();
            return v instanceof String ? (String) v : String.valueOf(v);
        } catch (Exception e) { return null; }
    }

    @Override protected void onDestroy() {
        finished = true;
        main.removeCallbacksAndMessages(null);
        if (web != null) { web.stopLoading(); web.destroy(); }
        super.onDestroy();
    }
}
