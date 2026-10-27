package com.asas.gamestudio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * خدمة أمامية تعمل ما دام الذكاء الاصطناعي يصنع أو يطوّر لعبة، حتى لو خرج المستخدم من التطبيق:
 * بدونها يجمّد أندرويد التطبيق بعد ثوانٍ في الخلفية فينقطع الاتصال.
 * تُظهر إشعارًا بالمرحلة الحالية، وتمسك قفل تشغيل جزئي حتى لا ينام المعالج والشاشة مطفأة.
 */
class StudioService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val text = intent?.getStringExtra(EXTRA_TEXT) ?: "جاري العمل على اللعبة…"
        ServiceCompat.startForeground(
            this, PROGRESS_ID, progressNotification(this, text),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
        )
        if (wakeLock?.isHeld != true) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GameStudio:work").apply {
                setReferenceCounted(false)
                acquire(3 * 60 * 60 * 1000L)
            }
        }
        running = true
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        // أندرويد 15: حد زمني لخدمات مزامنة البيانات
        stopSelf()
    }

    override fun onDestroy() {
        running = false
        wakeLock?.takeIf { it.isHeld }?.release()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_PROGRESS = "progress"
        private const val CHANNEL_DONE = "done"
        private const val PROGRESS_ID = 1
        private const val DONE_ID = 2
        private const val EXTRA_TEXT = "text"

        @Volatile var running = false
            private set

        fun start(context: Context, text: String) {
            channels(context)
            val i = Intent(context, StudioService::class.java).putExtra(EXTRA_TEXT, text)
            ContextCompat.startForegroundService(context, i)
        }

        fun update(context: Context, text: String) {
            if (!running) return
            try {
                NotificationManagerCompat.from(context).notify(PROGRESS_ID, progressNotification(context, text))
            } catch (_: SecurityException) {
                // بلا إذن الإشعارات: الخدمة تعمل لكن الإشعار مخفي
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, StudioService::class.java))
        }

        /** إشعار عند انتهاء العمل والمستخدم خارج التطبيق. */
        fun done(context: Context, title: String, text: String) {
            channels(context)
            val n = NotificationCompat.Builder(context, CHANNEL_DONE)
                .setSmallIcon(R.drawable.ic_stat_game)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(openApp(context))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
            try {
                NotificationManagerCompat.from(context).notify(DONE_ID, n)
            } catch (_: SecurityException) {
            }
        }

        private fun progressNotification(context: Context, text: String): Notification =
            NotificationCompat.Builder(context, CHANNEL_PROGRESS)
                .setSmallIcon(R.drawable.ic_stat_game)
                .setContentTitle("استوديو الألعاب يشتغل")
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(openApp(context))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setProgress(0, 0, true)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build()

        private fun openApp(context: Context): PendingIntent {
            val i = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            return PendingIntent.getActivity(context, 0, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        private fun channels(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL_PROGRESS, "التقدم", NotificationManager.IMPORTANCE_LOW))
            nm.createNotificationChannel(NotificationChannel(CHANNEL_DONE, "اكتمال العمل", NotificationManager.IMPORTANCE_HIGH))
        }
    }
}
