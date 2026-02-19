package com.web2apk.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.view.animation.AnimationSet;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;
import android.view.animation.ScaleAnimation;
import android.view.animation.TranslateAnimation;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

public class SplashActivity extends AppCompatActivity {

    private static final int SPLASH_DURATION = 2000; // 2 seconds for better animation experience

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_splash);

        // Get views
        ImageView logoImage = findViewById(R.id.splashLogo);
        TextView appName = findViewById(R.id.splashAppName);
        TextView loadingText = findViewById(R.id.splashLoadingText);
        ProgressBar progressBar = findViewById(R.id.splashProgress);
        TextView versionText = findViewById(R.id.splashVersion);

        // Initially hide all views
        logoImage.setAlpha(0f);
        appName.setAlpha(0f);
        loadingText.setAlpha(0f);
        progressBar.setAlpha(0f);
        versionText.setAlpha(0f);

        // Logo animation - Scale up with bounce + fade in
        AnimationSet logoAnimation = new AnimationSet(true);
        logoAnimation.setInterpolator(new OvershootInterpolator(1.5f));

        ScaleAnimation scaleUp = new ScaleAnimation(
                0.3f, 1.0f, 0.3f, 1.0f,
                Animation.RELATIVE_TO_SELF, 0.5f,
                Animation.RELATIVE_TO_SELF, 0.5f);
        scaleUp.setDuration(700);

        AlphaAnimation fadeInLogo = new AlphaAnimation(0.0f, 1.0f);
        fadeInLogo.setDuration(500);

        logoAnimation.addAnimation(scaleUp);
        logoAnimation.addAnimation(fadeInLogo);
        logoAnimation.setFillAfter(true);

        // App name animation - Slide up + fade in (delayed)
        AnimationSet appNameAnimation = new AnimationSet(true);
        appNameAnimation.setInterpolator(new DecelerateInterpolator());

        TranslateAnimation slideUp = new TranslateAnimation(
                Animation.RELATIVE_TO_SELF, 0,
                Animation.RELATIVE_TO_SELF, 0,
                Animation.RELATIVE_TO_SELF, 0.5f,
                Animation.RELATIVE_TO_SELF, 0);
        slideUp.setDuration(500);

        AlphaAnimation fadeInName = new AlphaAnimation(0.0f, 1.0f);
        fadeInName.setDuration(500);

        appNameAnimation.addAnimation(slideUp);
        appNameAnimation.addAnimation(fadeInName);
        appNameAnimation.setFillAfter(true);
        appNameAnimation.setStartOffset(300);

        // Progress bar fade in (delayed)
        AlphaAnimation progressFadeIn = new AlphaAnimation(0.0f, 1.0f);
        progressFadeIn.setDuration(400);
        progressFadeIn.setStartOffset(600);
        progressFadeIn.setFillAfter(true);

        // Loading text pulse animation
        AlphaAnimation loadingFadeIn = new AlphaAnimation(0.0f, 0.8f);
        loadingFadeIn.setDuration(400);
        loadingFadeIn.setStartOffset(700);
        loadingFadeIn.setFillAfter(true);

        // Version text subtle fade in
        AlphaAnimation versionFadeIn = new AlphaAnimation(0.0f, 0.6f);
        versionFadeIn.setDuration(600);
        versionFadeIn.setStartOffset(800);
        versionFadeIn.setFillAfter(true);

        // Start all animations
        logoImage.startAnimation(logoAnimation);
        appName.startAnimation(appNameAnimation);
        progressBar.startAnimation(progressFadeIn);
        loadingText.startAnimation(loadingFadeIn);
        versionText.startAnimation(versionFadeIn);

        // Pulse animation for loading text after initial fade
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            AlphaAnimation pulse = new AlphaAnimation(0.4f, 1.0f);
            pulse.setDuration(800);
            pulse.setRepeatMode(Animation.REVERSE);
            pulse.setRepeatCount(Animation.INFINITE);
            pulse.setInterpolator(new AccelerateDecelerateInterpolator());
            loadingText.startAnimation(pulse);
        }, 1100);

        // Navigate to main activity after delay
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            Intent intent = new Intent(SplashActivity.this, MainActivity.class);
            startActivity(intent);
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
            finish();
        }, SPLASH_DURATION);
    }
}
