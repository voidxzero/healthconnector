package app.healthconnector

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.work.WorkManager
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The web app's way to Health Connect: permissions, a manual sync, and the schedule. */
@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private fun sdk(): String = when (HealthConnectClient.getSdkStatus(context)) {
        HealthConnectClient.SDK_AVAILABLE -> "available"
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update_required"
        else -> "unavailable"
    }

    /** How many of the data types haven't been allowed yet. */
    private suspend fun missing(): Int {
        if (sdk() != "available") return HcSync.SPECS.size
        val granted = HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()
        return HcSync.SPECS.count { it.permission !in granted }
    }

    @PluginMethod
    fun status(call: PluginCall) {
        scope.launch {
            try {
                call.resolve(JSObject().apply {
                    put("sdk", sdk())
                    put("missing", missing())
                    put("total", HcSync.SPECS.size)
                    put("configured", HcSync.config(context) != null)
                    put("lastStatus", HcSync.lastStatus(context))
                    put("lastSyncAt", HcSync.lastSyncAt(context).toString())
                    put("intervalMinutes", HcSync.intervalMinutes(context))
                    // What "full access" really covers on this phone, and which Health Connect is answering.
                    if (sdk() == "available") {
                        val granted = HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()
                        put("history", HcSync.PERMISSION_HISTORY in granted)
                        put("background", HcSync.PERMISSION_BACKGROUND in granted)
                    }
                    put("android", Build.VERSION.SDK_INT)
                })
            } catch (e: Exception) {
                call.reject(e.message ?: "status failed")
            }
        }
    }

    @PluginMethod
    fun requestAccess(call: PluginCall) {
        if (sdk() != "available") return call.reject("Health Connect isn't available on this phone")
        val intent = PermissionController.createRequestPermissionResultContract().createIntent(context, HcSync.ALL_PERMISSIONS)
        startActivityForResult(call, intent, "permissionsResult")
    }

    @ActivityCallback
    private fun permissionsResult(call: PluginCall?, @Suppress("UNUSED_PARAMETER") result: ActivityResult) {
        if (call == null) return
        scope.launch { call.resolve(JSObject().put("missing", missing())) }
    }

    @PluginMethod
    fun configure(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url is required")
        val token = call.getString("token") ?: return call.reject("token is required")
        HcSync.saveConfig(context, HcSync.Config(url.trimEnd('/'), (call.getString("backupUrl") ?: "").trimEnd('/'), call.getString("instanceId") ?: "", token))
        HcSync.schedule(context)
        call.resolve()
    }

    @PluginMethod
    fun syncNow(call: PluginCall) {
        scope.launch {
            try {
                call.resolve(JSObject().put("sent", HcSync.run(context)))
            } catch (e: Exception) {
                HcSync.recordError(context, e)
                call.reject(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    /** "What's in Health Connect?": allowed or not, how many records, from which apps, how recent (one type per call). */
    @PluginMethod
    fun inspect(call: PluginCall) {
        val type = call.getString("type") ?: return call.reject("type is required")
        scope.launch {
            try {
                call.resolve(JSObject(withContext(Dispatchers.Default) { HcSync.inspect(context, type).toString() }))
            } catch (e: Exception) {
                call.reject(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    /** On-device mode: one data type's records, returned instead of posted. */
    @PluginMethod
    fun readRecords(call: PluginCall) {
        val type = call.getString("type") ?: return call.reject("type is required")
        val since = call.data.optLong("sinceMs", 0L)
        val until = call.data.optLong("untilMs", 0L)
        scope.launch {
            try {
                // Building a big JSON array (heart rate can be tens of thousands of samples) stays off the main thread.
                val records = withContext(Dispatchers.Default) { JSArray(HcSync.readType(context, type, since, until).toString()) }
                call.resolve(JSObject().put("records", records))
            } catch (e: Exception) {
                call.reject(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    /** What the owner calls this device ("Richard's Pixel"), or failing that its make and model ("Google Pixel 8"). */
    @PluginMethod
    fun deviceName(call: PluginCall) {
        val given = try {
            Settings.Global.getString(context.contentResolver, "device_name")
        } catch (e: Exception) {
            null
        }
        val model = if (Build.MODEL.startsWith(Build.MANUFACTURER, ignoreCase = true)) Build.MODEL
        else "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
        call.resolve(JSObject().put("name", given?.trim().takeUnless { it.isNullOrEmpty() } ?: model))
    }

    @PluginMethod
    fun openHealthConnect(call: PluginCall) {
        val intent = if (sdk() == "update_required") {
            Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding"))
        } else {
            Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
        }
        try {
            activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve()
        } catch (e: Exception) {
            call.reject("Couldn't open Health Connect")
        }
    }

    /** How often the background sync runs, in minutes (0 = only when asked). */
    @PluginMethod
    fun setInterval(call: PluginCall) {
        val minutes = call.data.optInt("minutes", HcSync.DEFAULT_INTERVAL_MINUTES)
        HcSync.saveInterval(context, minutes.coerceIn(0, 7 * 24 * 60))
        HcSync.schedule(context)
        call.resolve()
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        WorkManager.getInstance(context).cancelUniqueWork("sync")
        HcSync.clear(context)
        call.resolve()
    }
}
