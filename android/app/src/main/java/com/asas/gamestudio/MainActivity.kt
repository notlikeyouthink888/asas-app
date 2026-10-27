package com.asas.gamestudio

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.view.PixelCopy
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * غلاف أندرويد لاستوديو الألعاب: كل الواجهة والذكاء الاصطناعي في assets/www (HTML/JS)،
 * وهنا فقط ما يحتاج النظام: ملء الشاشة، الاتجاه، إبقاء الشاشة مضاءة، المشاركة، الحفظ، ولقطة الشاشة.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private val main = Handler(Looper.getMainLooper())

    // أثناء صنع لعبة أو تطويرها لا نوقف الـ WebView حين يخرج المستخدم من التطبيق،
    // وخدمة StudioService الأمامية تمنع أندرويد من تجميد التطبيق فيبقى الاتصال قائمًا
    @Volatile private var busy = false

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val pickFile = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(true)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        setContentView(web)
        // عملية رسم الصفحة تبقى بأولوية عالية حتى لو التطبيق بالخلفية
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
            setSupportZoom(false)
        }

        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val res = loader.shouldInterceptRequest(request.url) ?: return null
                // الألعاب تعمل في iframe معزول (origin = null)، فنسمح لها بتحميل المكتبات المحلية
                res.responseHeaders = (res.responseHeaders ?: emptyMap()) + mapOf("Access-Control-Allow-Origin" to "*")
                return res
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == "appassets.androidplatform.net") return false
                // الروابط الخارجية (مثل صفحة مفاتيح OpenRouter) تفتح بالمتصفح
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                } catch (_: ActivityNotFoundException) {
                }
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                pickFile.launch("*/*")
                return true
            }

            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.d("GameStudio", "${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                return true
            }
        }

        web.addJavascriptInterface(Bridge(), "Android")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.onAndroidBack ? String(window.onAndroidBack()) : 'false'") { r ->
                    if (r == null || !r.contains("true")) finish()
                }
            }
        })

        if (savedInstanceState == null) {
            web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
        } else {
            web.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        if (!busy) web.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onDestroy() {
        StudioService.stop(this)
        web.destroy()
        super.onDestroy()
    }

    /** ما تستدعيه الواجهة عبر window.Android (يعمل على خيط خلفي، فواجهة النظام تمر عبر main). */
    inner class Bridge {

        /** بداية ونهاية عمل طويل: يشغّل الخدمة الأمامية (الإشعار) ويبقي الشاشة مضاءة ما دام التطبيق ظاهرًا. */
        @JavascriptInterface
        fun busy(on: Boolean, text: String) {
            busy = on
            main.post {
                if (on) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    try {
                        StudioService.start(this@MainActivity, text)
                    } catch (e: Exception) {
                        Log.w("GameStudio", "service", e)
                    }
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    StudioService.stop(this@MainActivity)
                }
            }
        }

        @JavascriptInterface
        fun keepAwake(on: Boolean) = busy(on, "جاري العمل على اللعبة…")

        /** نص المرحلة الحالية في الإشعار. */
        @JavascriptInterface
        fun progress(text: String) = StudioService.update(this@MainActivity, text)

        /** إشعار «اكتمل» يظهر حتى لو المستخدم خارج التطبيق. */
        @JavascriptInterface
        fun notifyDone(title: String, text: String) = StudioService.done(this@MainActivity, title, text)

        @JavascriptInterface
        fun notificationsAllowed(): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

        @JavascriptInterface
        fun requestNotifications() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                main.post { askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
            }
        }

        /** هل التطبيق مستثنى من توفير البطارية (فيعمل بالخلفية بلا قيود)؟ */
        @JavascriptInterface
        fun backgroundAllowed(): Boolean {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            return pm.isIgnoringBatteryOptimizations(packageName)
        }

        @JavascriptInterface
        fun requestBackground() {
            main.post {
                try {
                    startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
                } catch (_: ActivityNotFoundException) {
                    try {
                        startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                    } catch (_: ActivityNotFoundException) {
                    }
                }
            }
        }

        @JavascriptInterface
        fun setOrientation(mode: String) {
            main.post {
                requestedOrientation = when (mode) {
                    "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                    else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                }
            }
        }

        @JavascriptInterface
        fun fullscreen(on: Boolean) {
            main.post {
                val c = WindowCompat.getInsetsController(window, web)
                if (on) {
                    c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    c.hide(WindowInsetsCompat.Type.systemBars())
                } else {
                    c.show(WindowInsetsCompat.Type.systemBars())
                }
            }
        }

        @JavascriptInterface
        fun toast(text: String) {
            main.post { Toast.makeText(this@MainActivity, text, Toast.LENGTH_SHORT).show() }
        }

        @JavascriptInterface
        fun appVersion(): String =
            try { packageManager.getPackageInfo(packageName, 0).versionName ?: "" } catch (_: Exception) { "" }

        /** يشارك ملفًا (لعبة HTML أو نسخة احتياطية) عبر تطبيقات أندرويد. */
        @JavascriptInterface
        fun share(name: String, content: String, mime: String) {
            val dir = File(cacheDir, "exports").apply { mkdirs() }
            val file = File(dir, safeName(name))
            file.writeText(content)
            val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mime
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            main.post { startActivity(Intent.createChooser(send, name)) }
        }

        /** يحفظ في مجلد التنزيلات (أندرويد 10 فما فوق). يرجع false إن تعذر. */
        @JavascriptInterface
        fun saveToDownloads(name: String, content: String, mime: String): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
            return try {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, safeName(name))
                    put(MediaStore.Downloads.MIME_TYPE, mime)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return false
                contentResolver.openOutputStream(uri)?.use { it.write(content.toByteArray()) }
                true
            } catch (e: Exception) {
                Log.w("GameStudio", "saveToDownloads", e)
                false
            }
        }

        /**
         * لقطة شاشة لمنطقة اللعبة (بإحداثيات CSS) حتى يرى الذكاء الاصطناعي اللعبة.
         * PixelCopy يلتقط WebGL أيضًا. النتيجة تصل إلى window.__onCapture(id, base64Jpeg).
         */
        @JavascriptInterface
        fun capture(id: String, x: Float, y: Float, w: Float, h: Float) {
            main.post {
                val density = resources.displayMetrics.density
                val loc = IntArray(2)
                web.getLocationInWindow(loc)
                val rect = Rect(
                    (loc[0] + x * density).toInt(),
                    (loc[1] + y * density).toInt(),
                    (loc[0] + (x + w) * density).toInt(),
                    (loc[1] + (y + h) * density).toInt()
                )
                if (rect.width() <= 0 || rect.height() <= 0) {
                    deliver(id, "")
                    return@post
                }
                val bmp = Bitmap.createBitmap(rect.width(), rect.height(), Bitmap.Config.ARGB_8888)
                try {
                    PixelCopy.request(window, rect, bmp, { result ->
                        if (result == PixelCopy.SUCCESS) deliver(id, encode(bmp)) else deliver(id, "")
                    }, main)
                } catch (e: Exception) {
                    Log.w("GameStudio", "capture", e)
                    deliver(id, "")
                }
            }
        }
    }

    private fun encode(src: Bitmap): String {
        val max = 1024f
        val scale = minOf(1f, max / maxOf(src.width, src.height))
        val bmp = if (scale < 1f)
            Bitmap.createScaledBitmap(src, (src.width * scale).toInt(), (src.height * scale).toInt(), true)
        else src
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 72, out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    private fun deliver(id: String, b64: String) {
        web.evaluateJavascript("window.__onCapture && window.__onCapture(${JSONObject.quote(id)}, '$b64')", null)
    }

    private fun safeName(name: String) = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(80).ifBlank { "game.html" }
}
