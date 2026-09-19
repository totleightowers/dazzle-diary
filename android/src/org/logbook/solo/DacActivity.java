package org.logbook.solo;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Signs into a Diamond Art Club account and borrows the drill legends of the
 * kits you own, by adding them to that account the way DAC's own logbook does.
 *
 * This screen is deliberately cut off from the app. Its WebView has NO
 * JavascriptInterface: DAC's page — and every script DAC loads on it — has no
 * way to reach Dazzle Diary. The app hands over a script to run (see
 * core/dacsync.js); this screen runs it on DAC's own page, from DAC's own
 * origin, and only ever READS the result it leaves behind. That result is
 * written to a file for the app, which treats it as untrusted.
 *
 * No password passes through here. You sign in on DAC's own pages.
 */
public class DacActivity extends Activity {

    static final String EXTRA_SCRIPT = "script";
    static final String RESULT_FILE = "dac-sync.json";
    private static final String ACCOUNT = "https://www.diamondartclub.com/pages/account";

    /* Is this page signed in? DAC's account page carries the answer for its own
       logbook: "true", "false", or no element at all on other pages. */
    private static final String CHECK =
        "(function(){var e=document.getElementById('logbook-customer-data');"
        + "return e?e.getAttribute('data-logged-in'):'none';})()";
    private static final String READ = "JSON.stringify(window.__dd||null)";

    private WebView web;
    private TextView status;
    private String script;
    private boolean running;
    private boolean finished;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        script = getIntent().getStringExtra(EXTRA_SCRIPT);
        if (script == null || script.isEmpty()) { finish(); return; }

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
        s.setJavaScriptEnabled(true);          // DAC's pages, and the sign-in, need it
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // deliberately no addJavascriptInterface — see the class comment

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                // stay in here for signing in; anything that is not https goes nowhere
                return !"https".equals(r.getUrl().getScheme());
            }
            @Override public void onPageFinished(WebView v, String url) { onPage(url); }
        });

        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        web.loadUrl(ACCOUNT);
    }

    private void onPage(String url) {
        if (running || finished) return;
        Uri u = Uri.parse(url);
        String host = u.getHost() == null ? "" : u.getHost();
        if (!host.equals("www.diamondartclub.com") && !host.equals("diamondartclub.com")) return;
        final String path = u.getPath() == null ? "" : u.getPath();
        web.evaluateJavascript(CHECK, value -> {
            String signedIn = unquote(value);
            if ("true".equals(signedIn)) { start(); return; }
            // signed in now, but landed on Shopify's own account page: go to DAC's
            boolean account = path.startsWith("/account") && !path.startsWith("/account/login")
                && !path.contains("register") && !path.contains("reset") && !path.contains("activate");
            if ("none".equals(signedIn) && account) web.loadUrl(ACCOUNT);
        });
    }

    private void start() {
        running = true;
        say("Signed in. Adding your kits and fetching their colours…");
        web.evaluateJavascript(script, null);
        main.postDelayed(this::poll, 1200);
    }

    private void poll() {
        if (finished) return;
        web.evaluateJavascript(READ, value -> {
            try {
                String text = unquote(value);
                if (text == null || "null".equals(text)) { main.postDelayed(this::poll, 1200); return; }
                JSONObject dd = new JSONObject(text);
                if (dd.optBoolean("done")) { deliver(text); return; }
                JSONObject p = dd.optJSONObject("progress");
                if (p != null) say("Kit " + Math.min(p.optInt("done") + 1, p.optInt("total"))
                    + " of " + p.optInt("total") + " · " + p.optString("now", ""));
            } catch (Exception ignored) { /* not ready yet */ }
            main.postDelayed(this::poll, 1200);
        });
    }

    /** Hand the result to the app through a file, and go back. */
    private void deliver(String text) {
        finished = true;
        try {
            File dir = new File(getFilesDir(), "media");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            try (FileOutputStream out = new FileOutputStream(new File(dir, RESULT_FILE))) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            setResult(RESULT_OK);
        } catch (Exception e) { setResult(RESULT_CANCELED); }
        finish();
    }

    private void say(String text) { main.post(() -> status.setText(text)); }

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
