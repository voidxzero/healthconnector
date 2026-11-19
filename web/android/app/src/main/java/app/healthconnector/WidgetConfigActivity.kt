package app.healthconnector

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import com.getcapacitor.BridgeActivity

/**
 * Where a widget is set up. The launcher opens this when a widget is added or reconfigured; it shows the web app's
 * own setup screen (web/src/screens/WidgetSetup.tsx), which tells the plugin when it is done.
 */
class WidgetConfigActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(HealthConnectPlugin::class.java)
        registerPlugin(HapticsPlugin::class.java)
        registerPlugin(WidgetsPlugin::class.java)
        val id = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        WidgetBridge.configuring = id
        // Backing out must leave no widget behind, so the answer starts as "cancelled".
        setResult(Activity.RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
        super.onCreate(savedInstanceState)
    }

    override fun onDestroy() {
        WidgetBridge.configuring = AppWidgetManager.INVALID_APPWIDGET_ID
        super.onDestroy()
    }
}
