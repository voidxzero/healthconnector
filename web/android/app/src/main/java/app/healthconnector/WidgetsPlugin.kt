package app.healthconnector

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

/** State shared between the activities and the plugin. */
object WidgetBridge {
    /** The screen a tapped widget asked for ("sleep", "activity"…), until the web app has picked it up. */
    @JvmField var pendingRoute: String? = null

    /** The widget being set up, while WidgetConfigActivity is open. */
    @JvmField var configuring: Int = AppWidgetManager.INVALID_APPWIDGET_ID
}

/** The web app's way to the home screen widgets (web/src/lib/widgets.ts). */
@CapacitorPlugin(name = "HcWidgets")
class WidgetsPlugin : Plugin() {
    /** The app's metric definitions (names, units, colours, value scales). Widgets format themselves from this. */
    @PluginMethod
    fun setCatalog(call: PluginCall) {
        val json = call.getString("json") ?: return call.reject("json is required")
        WidgetCatalog.save(context, json)
        WidgetUpdater.request(context)
        call.resolve()
    }

    /** Set when this screen was opened by the launcher to set up (or change) a widget. */
    @PluginMethod
    fun pendingConfigure(call: PluginCall) {
        val id = WidgetBridge.configuring
        val out = JSObject()
        if (id != AppWidgetManager.INVALID_APPWIDGET_ID) {
            out.put("id", id)
            WidgetConfig.load(context, id)?.let { out.put("config", JSONObject(it.toJson())) }
        }
        call.resolve(out)
    }

    @PluginMethod
    fun finishConfigure(call: PluginCall) {
        val id = call.getInt("id") ?: return call.reject("id is required")
        val c = call.getObject("config") ?: return call.reject("config is required")
        val cfg = WidgetConfig(
            metric = c.getString("metric") ?: return call.reject("metric is required"),
            style = c.optString("style", "both"),
            kind = c.optString("kind", "bar"),
            days = c.optInt("days", 7).coerceIn(2, 60),
            rated = c.optBoolean("rated", true),
        )
        WidgetConfig.save(context, id, cfg)
        WidgetUpdater.placeholder(context, id) // the launcher wants something on screen as soon as setup ends
        WidgetUpdater.request(context)
        activity?.runOnUiThread {
            activity.setResult(Activity.RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
            activity.finish()
        }
        call.resolve()
    }

    @PluginMethod
    fun cancelConfigure(call: PluginCall) {
        activity?.runOnUiThread { activity.finish() } // the result is already "cancelled"
        call.resolve()
    }

    /** Redraw the widgets from fresh data (after the app has synced). */
    @PluginMethod
    fun refresh(call: PluginCall) {
        WidgetUpdater.request(context)
        call.resolve()
    }

    @PluginMethod
    fun takeRoute(call: PluginCall) {
        val out = JSObject()
        WidgetBridge.pendingRoute?.let { out.put("route", it) }
        WidgetBridge.pendingRoute = null
        call.resolve(out)
    }

    /** How many widgets are on the home screen. */
    @PluginMethod
    fun count(call: PluginCall) {
        val n = AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, MetricWidgetProvider::class.java)).size
        call.resolve(JSObject().put("count", n))
    }
}
