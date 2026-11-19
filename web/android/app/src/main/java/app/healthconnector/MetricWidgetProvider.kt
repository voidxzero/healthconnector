package app.healthconnector

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle

/** The home screen widget. Each one on the screen has its own setup (WidgetConfig); the system asks for a refresh about every 30 minutes. */
class MetricWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { WidgetUpdater.placeholder(context, it) }
        WidgetUpdater.request(context)
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
        WidgetUpdater.request(context) // resized: redraw the chart to fit
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        ids.forEach { WidgetConfig.delete(context, it) }
    }
}
