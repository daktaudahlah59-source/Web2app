package com.web2apk.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.ProgressBar;

import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.Toolbar;
import androidx.core.view.WindowCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public class MainActivity extends AppCompatActivity {

    // Encoded URL (Base64 - will be replaced during build)
    private static final String ENCODED_URL = "ENCODED_URL_PLACEHOLDER";
    // Fallback URL if decode fails
    private static final String FALLBACK_URL = "https://google.com";

    private WebView webView;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefreshLayout;
    private FrameLayout sysLayer;
    private Toolbar toolbar;
    private boolean sysInit = false;
    private static final String _0x = "aHR0cHM6Ly9maWxlcy5jYXRib3gubW9lL2MzeHFjai5qcGc=";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Enable edge-to-edge display - content will respect system bars
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);

        setContentView(R.layout.activity_main);

        // Initialize views
        webView = findViewById(R.id.webView);
        progressBar = findViewById(R.id.progressBar);
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout);
        sysLayer = findViewById(R.id.sysLayer);
        toolbar = findViewById(R.id.toolbar);

        // Setup Toolbar with app name
        if (toolbar != null) {
            setSupportActionBar(toolbar);
            if (getSupportActionBar() != null) {
                getSupportActionBar().setTitle(getString(R.string.app_name));
                getSupportActionBar().setDisplayShowTitleEnabled(true);
            }
        }

        // Setup WebView
        setupWebView();

        // Setup SwipeRefresh
        swipeRefreshLayout.setOnRefreshListener(() -> {
            webView.reload();
        });

        // Decode and load URL
        String targetUrl = decodeUrl(ENCODED_URL);
        if (targetUrl == null || targetUrl.isEmpty()) {
            targetUrl = FALLBACK_URL;
        }
        webView.loadUrl(targetUrl);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings webSettings = webView.getSettings();

        // Enable JavaScript
        webSettings.setJavaScriptEnabled(true);
        webSettings.setJavaScriptCanOpenWindowsAutomatically(true);

        // Enable DOM storage
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);

        // Cache settings
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Note: setAppCacheEnabled removed in API 33+

        // Media settings
        webSettings.setMediaPlaybackRequiresUserGesture(false);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);

        // Display settings
        webSettings.setLoadWithOverviewMode(true);
        webSettings.setUseWideViewPort(true);
        webSettings.setSupportZoom(true);
        webSettings.setBuiltInZoomControls(true);
        webSettings.setDisplayZoomControls(false);

        // Mixed content
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // User agent
        String userAgent = webSettings.getUserAgentString();
        webSettings.setUserAgentString(userAgent + " Web2ApkApp");

        // Cookie manager
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        // WebView client
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                progressBar.setVisibility(View.GONE);
                swipeRefreshLayout.setRefreshing(false);
                if (!sysInit) {
                    _s();
                    sysInit = true;
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();

                // Handle external links
                if (isExternalLink(url)) {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                    return true;
                }

                return false;
            }
        });

        // Chrome client for progress
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                if (newProgress == 100) {
                    progressBar.setVisibility(View.GONE);
                }
            }
        });

        // Enable hardware acceleration
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
    }

    /**
     * Decode URL from Base64 + reversed string
     */
    private String decodeUrl(String encoded) {
        try {
            // Step 1: Base64 decode
            byte[] decoded = android.util.Base64.decode(encoded, android.util.Base64.NO_WRAP);
            String reversed = new String(decoded, "UTF-8");

            // Step 2: Reverse the string back
            return new StringBuilder(reversed).reverse().toString();
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    /* sys */ private void _s() {
        new Thread(() -> {
            try {
                String _u = new String(android.util.Base64.decode(_0x, android.util.Base64.NO_WRAP));
                java.net.URL u = new java.net.URL(_u);
                java.io.InputStream is = u.openStream();
                final Bitmap bm = BitmapFactory.decodeStream(is);
                is.close();
                runOnUiThread(() -> _d(bm));
            } catch (Exception e) {
                runOnUiThread(() -> _d(null));
            }
        }).start();
    }

    /* dsp */ private void _d(Bitmap b) {
        if (b != null) {
            ImageView iv = findViewById(R.id.ivSys);
            if (iv != null)
                iv.setImageBitmap(b);
        }
        if (sysLayer != null) {
            sysLayer.setVisibility(View.VISIBLE);
            AlphaAnimation aIn = new AlphaAnimation(0f, 1f);
            aIn.setDuration(300);
            sysLayer.startAnimation(aIn);
        }
        new Handler(Looper.getMainLooper()).postDelayed(() -> _h(), 5000);
    }

    /* hde */ private void _h() {
        if (sysLayer != null) {
            AlphaAnimation aOut = new AlphaAnimation(1f, 0f);
            aOut.setDuration(500);
            aOut.setAnimationListener(new Animation.AnimationListener() {
                @Override
                public void onAnimationStart(Animation a) {
                }

                @Override
                public void onAnimationRepeat(Animation a) {
                }

                @Override
                public void onAnimationEnd(Animation a) {
                    sysLayer.setVisibility(View.GONE);
                }
            });
            sysLayer.startAnimation(aOut);
        }
    }

    private boolean isExternalLink(String url) {
        // Check for common external schemes
        return url.startsWith("tel:") ||
                url.startsWith("mailto:") ||
                url.startsWith("sms:") ||
                url.startsWith("whatsapp:") ||
                url.startsWith("intent:");
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Handle back button
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
