package vn.savify.youtubeplayer.remote;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Điều khiển Youtube Player trên máy tính bằng điện thoại.
 * Mở đúng trang remote do máy tính phát ra (cùng Wi-Fi), nên giao diện luôn trùng với bản .exe đang chạy.
 * Lần đầu: gõ địa chỉ hiện trên màn hình máy tính (hoặc dán cả link trong mã QR). Các lần sau tự vào thẳng.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "remote";
    private static final String KEY_URL = "url";

    private SharedPreferences prefs;
    private WebView web;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String saved = prefs.getString(KEY_URL, "");
        if (saved.isEmpty()) showConnect("", "");
        else showWeb(saved);
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    /** Thêm http:// nếu thiếu; trả về null nếu để trống. */
    static String normalize(String in) {
        if (in == null) return null;
        String s = in.trim();
        if (s.isEmpty()) return null;
        if (!s.contains("://")) s = "http://" + s;
        return s;
    }

    private void showConnect(String prefill, String error) {
        releaseWeb();
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_VERTICAL);
        root.setPadding(dp(24), dp(24), dp(24), dp(24));
        root.setBackgroundColor(Color.parseColor("#121216"));

        TextView title = new TextView(this);
        title.setText("Youtube Player Remote");
        title.setTextColor(Color.WHITE);
        title.setTextSize(26);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText("Điện thoại và máy tính phải cùng Wi-Fi.\nGõ địa chỉ hiện trên màn hình máy tính (ví dụ 192.168.1.5:8080), hoặc dán cả link trong mã QR.");
        hint.setTextColor(Color.parseColor("#B0B0BC"));
        hint.setTextSize(16);
        hint.setPadding(0, dp(12), 0, dp(16));
        root.addView(hint);

        final EditText input = new EditText(this);
        input.setHint("192.168.1.5:8080");
        input.setHintTextColor(Color.parseColor("#707080"));
        input.setTextColor(Color.WHITE);
        input.setTextSize(20);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setImeOptions(EditorInfo.IME_ACTION_GO);
        input.setText(prefill);
        root.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));

        TextView err = new TextView(this);
        err.setText(error);
        err.setTextColor(Color.parseColor("#FF8A80"));
        err.setTextSize(15);
        err.setPadding(0, dp(8), 0, dp(8));
        err.setVisibility(error.isEmpty() ? View.GONE : View.VISIBLE);
        root.addView(err);

        Button go = new Button(this);
        go.setText("KẾT NỐI");
        go.setTextSize(20);
        go.setMinHeight(dp(60));
        root.addView(go, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        final Runnable connect = new Runnable() {
            @Override public void run() {
                String url = normalize(input.getText().toString());
                if (url == null) return;
                prefs.edit().putString(KEY_URL, url).apply();
                showWeb(url);
            }
        };
        go.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { connect.run(); } });
        input.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override public boolean onEditorAction(TextView v, int id, android.view.KeyEvent e) { connect.run(); return true; }
        });

        web = null;
        setContentView(root);
    }

    private void showWeb(String url) {
        releaseWeb();
        final WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true);
        w.setBackgroundColor(Color.parseColor("#121216"));
        final Uri base = Uri.parse(url);
        w.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (base.getHost() != null && base.getHost().equals(u.getHost())) return false;   // trang của máy tính: ở lại trong app
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* không có app mở */ }
                return true;
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (!r.isForMainFrame()) return;
                v.post(new Runnable() {   // không huỷ WebView ngay trong chính hàm gọi lại của nó
                    @Override public void run() {
                        showConnect(prefs.getString(KEY_URL, ""),
                            "Không kết nối được. Kiểm tra: máy tính đang mở Youtube Player, cùng Wi-Fi, và địa chỉ đúng.");
                    }
                });
            }
            @Override public void onPageFinished(WebView v, String u) { CookieManager.getInstance().flush(); }
        });
        web = w;
        setContentView(w);
        w.loadUrl(url);
    }

    private void releaseWeb() {
        if (web != null) {
            try { web.stopLoading(); web.destroy(); } catch (Exception e) { /* đã huỷ */ }
            web = null;
        }
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) { web.goBack(); return; }
        if (web == null) { super.onBackPressed(); return; }
        new AlertDialog.Builder(this)
            .setTitle("Youtube Player Remote")
            .setPositiveButton("Đổi máy tính", (d, i) -> showConnect(prefs.getString(KEY_URL, ""), ""))
            .setNegativeButton("Thoát", (d, i) -> finish())
            .setNeutralButton("Huỷ", null)
            .show();
    }

    @Override protected void onPause() { super.onPause(); if (web != null) web.onPause(); CookieManager.getInstance().flush(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() { releaseWeb(); super.onDestroy(); }
}
