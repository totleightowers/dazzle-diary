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
 * Signs into a Diamond Art Club account, ticks "Already purchased this?" for
 * each kit you own, then reads their drill legends.
 *
 * A kit only unlocks its legend when it came from an order or that box was
 * ticked; adding it to DAC's logbook by hand does not count. So this presses
 * DAC's own button, on DAC's own page, as you would.
 *
 * One page in all — the account page you land on after signing in — and the
 * rest is API calls made from it:
 *   read which kits already have colours; those are never touched
 *   tick the rest with DAC's own ticking service (update_purchased)
 *   read the colours again
 * The scripts are core/dacsync.js; you sign in yourself, on DAC's pages.
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
    static final String EXTRA_TICK = "tick";
    static final String EXTRA_LEGENDS = "legends";
    static final String RESULT_FILE = "dac-sync.json";

    private static final String BASE = "https://www.diamondartclub.com";
    private static final String ACCOUNT = BASE + "/pages/account";
    private static final String CHECK =
        "(function(){var e=document.getElementById('logbook-customer-data');"
        + "return e?e.getAttribute('data-logged-in'):'none';})()";
    private static final String READ_TICK = "JSON.stringify(window.__tk||null)";
    private static final String READ_LEGENDS = "JSON.stringify(window.__dd||null)";
    private static final long TICK_LIMIT_MS = 20 * 60 * 1000;

    private static final int SIGNIN = 0, PRE = 1, TICK = 2, POST = 3;

    private WebView web;
    private TextView status;
    private JSONArray kits;
    private String tickJs, legendJs;
    private JSONObject pre, tk;
    private int phase = SIGNIN;
    private boolean legendsRunning;
    private long tickStarted;
    private boolean finished;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        try { kits = new JSONArray(getIntent().getStringExtra(EXTRA_KITS)); } catch (Exception e) { kits = null; }
        tickJs = getIntent().getStringExtra(EXTRA_TICK);
        legendJs = getIntent().getStringExtra(EXTRA_LEGENDS);
        if (kits == null || kits.length() == 0 || tickJs == null || legendJs == null) {
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

        if (phase == TICK) {
            // the page reloaded mid-tick: run it again (it only toggles back on)
            startTick();
            return;
        }

        web.evaluateJavascript(CHECK, new ValueCallback<String>() {
            @Override public void onReceiveValue(String value) {
                String signedIn = unquote(value);
                if ("true".equals(signedIn)) {
                    if (phase == SIGNIN) phase = PRE;
                    if ((phase == PRE || phase == POST) && !legendsRunning) startLegends();
                    return;
                }
                boolean account = path.startsWith("/account") && !path.startsWith("/account/login")
                    && !path.contains("register") && !path.contains("reset") && !path.contains("activate");
                if ("none".equals(signedIn) && account) web.loadUrl(ACCOUNT);
            }
        });
    }

    /** Variants whose colour list is already available: ticked, so left alone. */
    private static JSONArray haveFrom(JSONObject dd) {
        JSONArray out = new JSONArray();
        JSONArray rs = dd == null ? null : dd.optJSONArray("results");
        for (int i = 0; rs != null && i < rs.length(); i++) {
            JSONObject r = rs.optJSONObject(i);
            JSONObject c = r == null ? null : r.optJSONObject("colors");
            if (c != null && "available".equals(c.optString("status"))) out.put(r.optString("variant"));
        }
        return out;
    }

    /* ------------------------------------------------------------ legends */

    private void startLegends() {
        legendsRunning = true;
        say(phase == PRE ? "Checking which kits already have colours…" : "Fetching the colour lists…");
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
                            if (dd.optBoolean("done")) { legendsDone(dd); return; }
                            JSONObject p = dd.optJSONObject("progress");
                            if (p != null) say((phase == PRE ? "Checking " : "Colour list ")
                                + Math.min(p.optInt("done") + 1, p.optInt("total")) + " of " + p.optInt("total"));
                        }
                    } catch (Exception ignored) { /* not ready yet */ }
                    pollLegends();
                }
            });
        } }, 1000);
    }

    private void legendsDone(JSONObject dd) {
        legendsRunning = false;
        if (phase == PRE) {
            pre = dd;
            phase = TICK;
            tickStarted = SystemClock.uptimeMillis();
            startTick();                  // same page: no navigation
        } else {
            deliver(dd);
        }
    }

    /* ------------------------------------------------------------ ticking */

    private void startTick() {
        say("Ticking your kits…");
        web.evaluateJavascript("window.__have = " + haveFrom(pre).toString() + ";\n" + tickJs, null);
        pollTick();
    }

    private void pollTick() {
        main.postDelayed(new Runnable() { @Override public void run() {
            if (finished || phase != TICK) return;
            web.evaluateJavascript(READ_TICK, new ValueCallback<String>() {
                @Override public void onReceiveValue(String value) {
                    if (finished || phase != TICK) return;
                    try {
                        String text = unquote(value);
                        if (text != null && !"null".equals(text)) {
                            JSONObject t = new JSONObject(text);
                            if (t.optBoolean("done")) { tickDone(t); return; }
                            JSONObject p = t.optJSONObject("progress");
                            if (p != null) say("Ticking " + Math.min(p.optInt("done") + 1, p.optInt("total"))
                                + " of " + p.optInt("total") + " · " + p.optString("now", ""));
                        }
                    } catch (Exception ignored) { /* not ready yet */ }
                    if (SystemClock.uptimeMillis() - tickStarted > TICK_LIMIT_MS) {
                        try { tickDone(new JSONObject().put("done", true).put("error", "Ticking took too long.")); }
                        catch (Exception e) { tickDone(null); }
                        return;
                    }
                    pollTick();
                }
            });
        } }, 1000);
    }

    private void tickDone(JSONObject t) {
        tk = t;
        phase = POST;
        startLegends();                   // same page again
    }

    /** Hand the result to the app through a file, and go back. */
    private void deliver(JSONObject dd) {
        finished = true;
        try {
            JSONObject out = new JSONObject().put("tk", tk == null ? JSONObject.NULL : tk)
                .put("pre", pre == null ? JSONObject.NULL : pre).put("dd", dd);
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
