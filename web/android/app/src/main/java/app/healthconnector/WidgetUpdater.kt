package app.healthconnector

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters

/** Reads Health Connect and redraws the widgets. */
object WidgetUpdater {
    private fun ids(ctx: Context) = AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, MetricWidgetProvider::class.java))

    fun hasWidgets(ctx: Context) = ids(ctx).isNotEmpty()

    /** Ask for an update soon, off the main thread. Several asks close together become one. */
    fun request(ctx: Context) {
        if (!hasWidgets(ctx)) return
        WorkManager.getInstance(ctx).enqueueUniqueWork("widgets", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<WidgetWorker>().build())
    }

    /** What a widget shows before its numbers arrive. */
    fun placeholder(ctx: Context, id: Int) {
        val cfg = WidgetConfig.load(ctx, id) ?: return
        val mgr = AppWidgetManager.getInstance(ctx)
        mgr.updateAppWidget(id, WidgetRenderer.render(ctx, id, cfg, WidgetCatalog.load(ctx), null, 140, 110, "Loading…"))
    }

    suspend fun updateAll(ctx: Context) {
        val mgr = AppWidgetManager.getInstance(ctx)
        val catalog = WidgetCatalog.load(ctx)
        val cache = HashMap<String, List<DayValue>>()
        // Why there is nothing to show, if there isn't: no access given yet, or Health Connect isn't there.
        val problem = healthProblem(ctx)
        for (id in ids(ctx)) {
            val cfg = WidgetConfig.load(ctx, id) ?: continue
            val info = catalog?.metrics?.get(cfg.metric)
            val opts = mgr.getAppWidgetOptions(id)
            // Held upright a widget is as wide as its minimum and as tall as its maximum; on its side, the other way round.
            val upright = ctx.resources.configuration.orientation != android.content.res.Configuration.ORIENTATION_LANDSCAPE
            val w = opts.getInt(if (upright) AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH else AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 140)
            val h = opts.getInt(if (upright) AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
            var series: List<DayValue>? = null
            var message = problem
            if (info != null && problem == null) {
                series = cache.getOrPut("${cfg.metric}/${cfg.days}") {
                    try { WidgetData.series(ctx, cfg.metric, info, cfg.days) } catch (e: Exception) { message = "Couldn't read Health Connect"; emptyList() }
                }
            }
            mgr.updateAppWidget(id, WidgetRenderer.render(ctx, id, cfg, catalog, series, w, h, message))
        }
    }

    private suspend fun healthProblem(ctx: Context): String? {
        if (androidx.health.connect.client.HealthConnectClient.getSdkStatus(ctx) != androidx.health.connect.client.HealthConnectClient.SDK_AVAILABLE) return "Health Connect isn't available"
        val granted = androidx.health.connect.client.HealthConnectClient.getOrCreate(ctx).permissionController.getGrantedPermissions()
        return if (HcSync.SPECS.none { it.permission in granted }) "Open the app to allow access" else null
    }
}

class WidgetWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = try {
        WidgetUpdater.updateAll(applicationContext)
        Result.success()
    } catch (e: Exception) {
        Result.retry()
    }
}
