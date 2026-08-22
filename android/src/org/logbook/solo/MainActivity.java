package org.logbook.solo;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;

/**
 * The whole app. No server, no Termux.
 *
 * The page is served from the APK's own assets over a virtual https origin, so
 * it gets a secure context (IndexedDB, service workers) and ordinary relative
 * URLs. Three things the page cannot do for itself are handled here:
 *
 *   /covers/… /photos/…  read files from the app's private storage
 *   /__net/?url=…        fetch another origin (the shops send no CORS headers)
 *   LogbookNative        write those files back
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final int FILE_CHOOSER = 1;
    private static final int MAX_DOWNLOAD = 12 * 1024 * 1024;

    private WebView web;
    private ValueCallback<Uri[]> pendingFiles;
    private File store;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        store = new File(getFilesDir(), "media");
        //noinspection ResultOfMethodCallIgnored
        store.mkdirs();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFFFBF9F5);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= 26)
            web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setBackgroundColor(0xFFFBF9F5);
        web.addJavascriptInterface(new Bridge(), "LogbookNative");

        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return route(r.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                                      FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = cb;
                boolean many = params != null && params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType(mimeFor(params));
                String[] extra = extraMimes(params);
                if (extra.length > 1) pick.putExtra(Intent.EXTRA_MIME_TYPES, extra);
                if (many) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(pick, many ? "Choose files" : "Choose a file"), FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e) { pendingFiles = null; return false; }
            }
        });

        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        web.loadUrl(ORIGIN + "/index.html");
    }

    /* ------------------------------------------------------------- routing */

    private WebResourceResponse route(Uri uri) {
        if (uri == null || !HOST.equals(uri.getHost())) return null;
        String path = uri.getPath() == null ? "/" : uri.getPath();

        try {
            if (path.startsWith("/__net/")) return proxy(uri.getQueryParameter("url"));
            if (path.startsWith("/covers/") || path.startsWith("/photos/")) return media(path);
            return asset(path);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 500, "Error",
                    headers(), new ByteArrayInputStream(String.valueOf(e.getMessage()).getBytes()));
        }
    }

    /** Bundled app files. Anything unknown falls back to index.html for routing. */
    private WebResourceResponse asset(String path) throws IOException {
        String name = path.equals("/") ? "index.html" : path.substring(1);
        InputStream in;
        try { in = getAssets().open("web/" + name); }
        catch (IOException miss) { in = getAssets().open("web/index.html"); name = "index.html"; }
        return new WebResourceResponse(mimeOf(name), "utf-8", 200, "OK", headers(), in);
    }

    /** Covers and progress photos, from the app's private storage. */
    private WebResourceResponse media(String path) throws IOException {
        File f = new File(store, path.substring(1));
        if (!f.getCanonicalPath().startsWith(store.getCanonicalPath()) || !f.exists())
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not found",
                    headers(), new ByteArrayInputStream(new byte[0]));
        Map<String, String> h = headers();
        h.put("Cache-Control", "public, max-age=31536000, immutable");
        return new WebResourceResponse(mimeOf(f.getName()), null, 200, "OK", h,
                new java.io.FileInputStream(f));
    }

    /**
     * The shops serve no CORS headers, so the page cannot call them directly.
     * Fetch on its behalf. Only https, only GET, and the response is handed
     * back verbatim.
     */
    private WebResourceResponse proxy(String raw) throws IOException {
        if (raw == null) throw new IOException("no url");
        String target = URLDecoder.decode(raw, "UTF-8");
        URL u = new URL(target);
        if (!"https".equalsIgnoreCase(u.getProtocol())) throw new IOException("https only");

        HttpURLConnection c = (HttpURLConnection) u.openConnection();
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent", "DiamondLogbook/2.0 (personal logbook)");
        c.setRequestProperty("Accept", "application/json, image/*;q=0.9, */*;q=0.8");

        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        if (in == null) in = new ByteArrayInputStream(new byte[0]);
        String type = c.getContentType();
        if (type == null) type = "application/octet-stream";
        String mime = type.split(";")[0].trim();
        return new WebResourceResponse(mime, "utf-8", code, code >= 400 ? "Error" : "OK", headers(), in);
    }

    private Map<String, String> headers() {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", ORIGIN);
        return h;
    }

    private static String mimeOf(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".js") || n.endsWith(".mjs")) return "text/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".webmanifest")) return "application/manifest+json";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".gif")) return "image/gif";
        return "image/jpeg";
    }

    /* -------------------------------------------------------------- bridge */

    public class Bridge {
        /** Write a cover or photo. Path is "covers/x.jpg" or "photos/y.jpg". */
        @JavascriptInterface
        public boolean save(String path, String base64) {
            try {
                File f = safe(path);
                if (f == null) return false;
                //noinspection ResultOfMethodCallIgnored
                f.getParentFile().mkdirs();
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (bytes.length > MAX_DOWNLOAD) return false;
                try (FileOutputStream out = new FileOutputStream(f)) { out.write(bytes); }
                return true;
            } catch (Exception e) { return false; }
        }


        /** WebView cannot perform downloads at all, so writes land here and go
         *  to the real Downloads folder via MediaStore (or app storage below
         *  API 29). Returns where it went, or null. */
        @JavascriptInterface
        public String saveDownload(String name, String base64, String mime) {
            try {
                byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
                if (name == null || name.contains("/") || name.contains("..")) return null;
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    android.content.ContentValues v = new android.content.ContentValues();
                    v.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(android.provider.MediaStore.Downloads.MIME_TYPE,
                          mime == null ? "application/octet-stream" : mime);
                    v.put(android.provider.MediaStore.Downloads.IS_PENDING, 1);
                    android.net.Uri item = getContentResolver().insert(
                        android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (item == null) return null;
                    java.io.OutputStream os = getContentResolver().openOutputStream(item);
                    if (os == null) return null;
                    os.write(bytes); os.close();
                    v.clear();
                    v.put(android.provider.MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(item, v, null, null);
                    return "your Downloads folder";
                }
                java.io.File dir = android.os.Environment.getExternalStoragePublicDirectory(
                        android.os.Environment.DIRECTORY_DOWNLOADS);
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                java.io.File out = new java.io.File(dir, name);
                try (java.io.FileOutputStream fo = new java.io.FileOutputStream(out)) { fo.write(bytes); }
                return "Downloads/" + name;
            } catch (Exception e) { return null; }
        }

        /** The status and navigation bars are part of the app's surface, so they
         *  follow whatever theme the page settled on — including the in-app
         *  Light/Dark override, which no static theme can know about. */
        @JavascriptInterface
        public void setBarColor(final boolean dark) {
            runOnUiThread(new Runnable() { @Override public void run() {
                try {
                    android.view.Window w = getWindow();
                    int bg   = dark ? 0xFF2A2320 : 0xFFFBF9F5;
                    int nav  = dark ? 0xFF352E29 : 0xFFFFFFFF;
                    w.setStatusBarColor(bg);
                    w.setNavigationBarColor(nav);
                    android.view.View v = w.getDecorView();
                    int flags = v.getSystemUiVisibility();
                    // dark text on a light bar, light text on a dark one
                    if (dark) flags &= ~android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    else      flags |=  android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    if (android.os.Build.VERSION.SDK_INT >= 26) {
                        if (dark) flags &= ~android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                        else      flags |=  android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    }
                    v.setSystemUiVisibility(flags);
                } catch (Exception ignored) {}
            }});
        }
        /** WebView's prefers-color-scheme does not follow the phone, so the
         *  page asks us instead. */
        @JavascriptInterface
        public boolean isSystemDark() {
            int mode = getResources().getConfiguration().uiMode
                     & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
            return mode == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        }

        @JavascriptInterface
        public boolean exists(String path) {
            File f = safe(path);
            return f != null && f.exists();
        }

        @JavascriptInterface
        public boolean remove(String path) {
            File f = safe(path);
            return f != null && f.delete();
        }

        private File safe(String path) {
            try {
                if (path == null || path.contains("..")) return null;
                if (!path.startsWith("covers/") && !path.startsWith("photos/")) return null;
                File f = new File(store, path);
                return f.getCanonicalPath().startsWith(store.getCanonicalPath()) ? f : null;
            } catch (IOException e) { return null; }
        }
    }

    /* ------------------------------------------------------------ plumbing */

    private static String[] extraMimes(WebChromeClient.FileChooserParams params) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        String[] accept = params == null ? null : params.getAcceptTypes();
        if (accept != null) for (String a : accept) {
            if (a == null) continue;
            for (String part : a.split(",")) {
                String t = part.trim().toLowerCase();
                if (t.isEmpty()) continue;
                if (t.equals(".csv") || t.equals("text/csv") || t.equals("text/comma-separated-values")) {
                    out.add("text/csv"); out.add("text/comma-separated-values");
                    out.add("application/csv"); out.add("text/plain");
                } else if (t.equals(".json") || t.equals("application/json")) {
                    out.add("application/json"); out.add("text/plain");
                } else if (t.startsWith(".")) out.add("application/octet-stream");
                else out.add(t);
            }
        }
        if (out.isEmpty()) out.add("*/*");
        return out.toArray(new String[0]);
    }

    private static String mimeFor(WebChromeClient.FileChooserParams params) {
        String[] m = extraMimes(params);
        if (m.length == 1) return m[0];
        String first = m[0];
        int slash = first.indexOf('/');
        String prefix = slash > 0 ? first.substring(0, slash) : first;
        for (String x : m) if (!x.startsWith(prefix + "/")) return "*/*";
        return prefix + "/*";
    }

    @Override protected void onActivityResult(int req, int result, Intent data) {
        if (req == FILE_CHOOSER) {
            if (pendingFiles != null) { pendingFiles.onReceiveValue(urisFrom(result, data)); pendingFiles = null; }
            return;
        }
        super.onActivityResult(req, result, data);
    }

    private Uri[] urisFrom(int result, Intent data) {
        if (result != RESULT_OK || data == null) return null;
        android.content.ClipData clip = data.getClipData();
        if (clip != null && clip.getItemCount() > 0) {
            Uri[] out = new Uri[clip.getItemCount()];
            for (int i = 0; i < clip.getItemCount(); i++) out[i] = clip.getItemAt(i).getUri();
            return out;
        }
        if (data.getData() != null) return new Uri[]{ data.getData() };
        return null;
    }

    @Override public void onConfigurationChanged(android.content.res.Configuration c) {
        super.onConfigurationChanged(c);
        if (web != null) web.evaluateJavascript("window.__logbookThemeChanged && window.__logbookThemeChanged()", null);
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
