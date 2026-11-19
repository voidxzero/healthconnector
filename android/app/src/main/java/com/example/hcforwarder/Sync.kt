package com.example.hcforwarder

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.temporal.ChronoUnit

object Sync {
    private const val PREFS = "cfg"
    const val LOOKBACK_DAYS = 14L

    val PERMISSIONS = setOf(
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND,
    )

    fun url(ctx: Context) = prefs(ctx).getString("url", "") ?: ""
    fun token(ctx: Context) = prefs(ctx).getString("token", "") ?: ""
    fun lastStatus(ctx: Context) = prefs(ctx).getString("status", "Never synced") ?: ""

    fun save(ctx: Context, url: String, token: String) =
        prefs(ctx).edit().putString("url", url.trim()).putString("token", token.trim()).apply()

    private fun setStatus(ctx: Context, s: String) =
        prefs(ctx).edit().putString("status", s).apply()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun stageName(t: Int) = when (t) {
        SleepSessionRecord.STAGE_TYPE_AWAKE -> "awake"
        SleepSessionRecord.STAGE_TYPE_SLEEPING -> "sleeping"
        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "out_of_bed"
        SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
        SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"
        SleepSessionRecord.STAGE_TYPE_REM -> "rem"
        SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED -> "awake_in_bed"
        else -> "unknown"
    }

    /** Reads recent sleep sessions and POSTs them. Returns number of sessions sent. */
    suspend fun run(ctx: Context): Int {
        val base = url(ctx).trimEnd('/')
        require(base.isNotEmpty()) { "Server URL not set" }

        if (HealthConnectClient.getSdkStatus(ctx) != HealthConnectClient.SDK_AVAILABLE) {
            throw IllegalStateException("Health Connect unavailable")
        }
        val client = HealthConnectClient.getOrCreate(ctx)
        val granted = client.permissionController.getGrantedPermissions()
        check(HealthPermission.getReadPermission(SleepSessionRecord::class) in granted) {
            "Sleep read permission not granted"
        }

        val end = Instant.now()
        val start = end.minus(LOOKBACK_DAYS, ChronoUnit.DAYS)
        val records = JSONArray()
        var pageToken: String? = null
        do {
            val resp = client.readRecords(
                ReadRecordsRequest(
                    SleepSessionRecord::class,
                    TimeRangeFilter.between(start, end),
                    pageToken = pageToken,
                )
            )
            for (r in resp.records) {
                val stages = JSONArray()
                for (s in r.stages) {
                    stages.put(
                        JSONObject()
                            .put("stage", stageName(s.stage))
                            .put("startTime", s.startTime.toString())
                            .put("endTime", s.endTime.toString())
                    )
                }
                records.put(
                    JSONObject()
                        .put("startTime", r.startTime.toString())
                        .put("endTime", r.endTime.toString())
                        .put("title", r.title ?: JSONObject.NULL)
                        .put("source", r.metadata.dataOrigin.packageName)
                        .put("stages", stages)
                )
            }
            pageToken = resp.pageToken
        } while (pageToken != null)

        val body = JSONObject().put("type", "SleepSession").put("records", records)
        withContext(Dispatchers.IO) { post("$base/ingest", token(ctx), body.toString()) }
        setStatus(ctx, "Synced ${records.length()} sessions at ${Instant.now()}")
        return records.length()
    }

    private fun post(url: String, token: String, json: String) {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.outputStream.use { it.write(json.toByteArray()) }
            val code = conn.responseCode
            if (code !in 200..299) throw java.io.IOException("Server returned HTTP $code")
        } finally {
            conn.disconnect()
        }
    }

    fun recordError(ctx: Context, e: Throwable) =
        setStatus(ctx, "Error: ${e.message ?: e.javaClass.simpleName}")
}
