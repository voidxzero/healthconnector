package app.healthconnector

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.reflect.KClass

/**
 * Reads Health Connect and sends it to the server as {records:[{type,start,end?,value,extra?,source}]}.
 * The server stores each record under (type, start, end, source), so sending the same
 * data again is harmless; every sync re-reads a few days to catch late-arriving data.
 */
object HcSync {
    private const val PREFS = "hc"
    private const val SLICE = 1000
    /** Bump when records gain new detail, so everything is sent again once. 2 = sleep segments. */
    private const val DATA_VERSION = 2
    private const val PERMISSION_BACKGROUND = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"
    private const val PERMISSION_HISTORY = "android.permission.health.READ_HEALTH_DATA_HISTORY"

    class Spec(val type: String, val cls: KClass<out Record>, val read: suspend (HealthConnectClient, Instant, Instant, JSONArray) -> Unit) {
        val permission: String get() = HealthPermission.getReadPermission(cls)
    }

    private suspend fun <T : Record> pages(client: HealthConnectClient, cls: KClass<T>, from: Instant, to: Instant, each: (T) -> Unit) {
        var token: String? = null
        do {
            val resp = client.readRecords(ReadRecordsRequest(cls, TimeRangeFilter.between(from, to), pageToken = token))
            resp.records.forEach(each)
            token = resp.pageToken
        } while (token != null)
    }

    private fun rec(type: String, r: Record, start: Instant, end: Instant?, value: Double?, extra: JSONObject? = null): JSONObject =
        JSONObject().put("type", type).put("start", start.toString())
            .also { if (end != null) it.put("end", end.toString()) }
            .also { if (value != null) it.put("value", value) }
            .also { if (extra != null) it.put("extra", extra) }
            .put("source", r.metadata.dataOrigin.packageName)

    /** One spec per data type; [map] turns a Health Connect record into zero or more server records. */
    private inline fun <reified T : Record> spec(type: String, crossinline map: (T) -> List<JSONObject>) =
        Spec(type, T::class) { client, from, to, out -> pages(client, T::class, from, to) { r -> map(r).forEach(out::put) } }

    /** An interval record whose value is [v]; the end is kept. */
    private fun interval(type: String, r: Record, s: Instant, e: Instant, v: Double?, extra: JSONObject? = null) =
        listOf(rec(type, r, s, e, v, extra))

    private fun instant(type: String, r: Record, t: Instant, v: Double?, extra: JSONObject? = null) =
        listOf(rec(type, r, t, null, v, extra))

    private fun minutes(a: Instant, b: Instant) = ChronoUnit.SECONDS.between(a, b) / 60.0

    /**
     * Minutes asleep, and the night's detail: stage totals and `segments`, the stages in time order as
     * [minutes after the session started, minutes long, "d"eep / "l"ight / "r"em / "a"wake] so the app can draw a hypnogram.
     */
    private fun sleepStages(r: SleepSessionRecord): Pair<Double, JSONObject> {
        val m = mutableMapOf("deep" to 0.0, "light" to 0.0, "rem" to 0.0, "awake" to 0.0)
        var asleepOther = 0.0
        val segments = JSONArray()
        for (s in r.stages.sortedBy { it.startTime }) {
            val mins = minutes(s.startTime, s.endTime)
            val code = when (s.stage) {
                SleepSessionRecord.STAGE_TYPE_DEEP -> { m["deep"] = m["deep"]!! + mins; "d" }
                SleepSessionRecord.STAGE_TYPE_LIGHT -> { m["light"] = m["light"]!! + mins; "l" }
                SleepSessionRecord.STAGE_TYPE_REM -> { m["rem"] = m["rem"]!! + mins; "r" }
                SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED,
                SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> { m["awake"] = m["awake"]!! + mins; "a" }
                else -> { asleepOther += mins; "l" } // "sleeping" with no detail is drawn as light sleep
            }
            val dur = Math.round(mins).toInt()
            if (dur >= 1) segments.put(JSONArray().put(Math.round(minutes(r.startTime, s.startTime)).toInt()).put(dur).put(code))
        }
        val asleep = if (r.stages.isEmpty()) minutes(r.startTime, r.endTime) else m["deep"]!! + m["light"]!! + m["rem"]!! + asleepOther
        if (asleepOther > 0) m["light"] = m["light"]!! + asleepOther
        val extra = JSONObject()
        if (r.stages.isNotEmpty()) {
            val stages = JSONObject()
            m.forEach { (k, v) -> stages.put(k, Math.round(v)) }
            extra.put("stages", stages)
            extra.put("segments", segments)
        }
        return asleep to extra
    }

    val SPECS: List<Spec> = listOf(
        spec<SleepSessionRecord>("sleep") { r ->
            val (asleep, extra) = sleepStages(r)
            interval("sleep", r, r.startTime, r.endTime, Math.round(asleep).toDouble(), extra)
        },
        spec<StepsRecord>("steps") { r -> interval("steps", r, r.startTime, r.endTime, r.count.toDouble()) },
        spec<DistanceRecord>("distance") { r -> interval("distance", r, r.startTime, r.endTime, r.distance.inMeters) },
        spec<ActiveCaloriesBurnedRecord>("active_calories") { r -> interval("active_calories", r, r.startTime, r.endTime, r.energy.inKilocalories) },
        spec<TotalCaloriesBurnedRecord>("total_calories") { r -> interval("total_calories", r, r.startTime, r.endTime, r.energy.inKilocalories) },
        spec<HydrationRecord>("hydration") { r -> interval("hydration", r, r.startTime, r.endTime, r.volume.inLiters) },
        spec<NutritionRecord>("nutrition") { r ->
            val extra = JSONObject()
            r.name?.let { extra.put("name", it) }
            r.protein?.let { extra.put("protein_g", it.inGrams) }
            r.totalCarbohydrate?.let { extra.put("carbs_g", it.inGrams) }
            r.totalFat?.let { extra.put("fat_g", it.inGrams) }
            interval("nutrition", r, r.startTime, r.endTime, r.energy?.inKilocalories, extra)
        },
        spec<ExerciseSessionRecord>("exercise") { r ->
            val extra = JSONObject().put("type", ExerciseSessionRecord.EXERCISE_TYPE_INT_TO_STRING_MAP[r.exerciseType] ?: "other_workout")
            r.title?.let { extra.put("title", it) }
            interval("exercise", r, r.startTime, r.endTime, Math.round(minutes(r.startTime, r.endTime)).toDouble(), extra)
        },
        // Heart rate comes as many samples; they're averaged into 5-minute buckets to keep the volume sensible.
        spec<HeartRateRecord>("heart_rate") { r ->
            r.samples.groupBy { it.time.epochSecond / 300 }.map { (bucket, s) ->
                rec("heart_rate", r, Instant.ofEpochSecond(bucket * 300), null, s.map { it.beatsPerMinute }.average())
            }
        },
        spec<RestingHeartRateRecord>("resting_heart_rate") { r -> instant("resting_heart_rate", r, r.time, r.beatsPerMinute.toDouble()) },
        spec<HeartRateVariabilityRmssdRecord>("hrv") { r -> instant("hrv", r, r.time, r.heartRateVariabilityMillis) },
        spec<WeightRecord>("weight") { r -> instant("weight", r, r.time, r.weight.inKilograms) },
        spec<BodyFatRecord>("body_fat") { r -> instant("body_fat", r, r.time, r.percentage.value) },
        spec<HeightRecord>("height") { r -> instant("height", r, r.time, r.height.inMeters) },
        spec<BloodPressureRecord>("blood_pressure") { r ->
            instant("blood_pressure", r, r.time, r.systolic.inMillimetersOfMercury, JSONObject().put("diastolic", r.diastolic.inMillimetersOfMercury))
        },
        spec<BloodGlucoseRecord>("blood_glucose") { r -> instant("blood_glucose", r, r.time, r.level.inMillimolesPerLiter) },
        spec<OxygenSaturationRecord>("oxygen_saturation") { r -> instant("oxygen_saturation", r, r.time, r.percentage.value) },
        spec<BodyTemperatureRecord>("body_temperature") { r -> instant("body_temperature", r, r.time, r.temperature.inCelsius) },
        spec<RespiratoryRateRecord>("respiratory_rate") { r -> instant("respiratory_rate", r, r.time, r.rate) },
    )

    /** Everything to ask for in one go: each data type, plus background reads and older history. */
    val ALL_PERMISSIONS: Set<String> = SPECS.map { it.permission }.toSet() + PERMISSION_BACKGROUND + PERMISSION_HISTORY

    // ---- saved settings

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    class Config(val url: String, val backupUrl: String, val instanceId: String, val token: String)

    fun config(ctx: Context): Config? {
        val p = prefs(ctx)
        val url = p.getString("url", "") ?: ""
        val token = p.getString("token", "") ?: ""
        return if (url.isEmpty() || token.isEmpty()) null
        else Config(url, p.getString("backupUrl", "") ?: "", p.getString("instanceId", "") ?: "", token)
    }

    fun saveConfig(ctx: Context, c: Config) = prefs(ctx).edit()
        .putString("url", c.url).putString("backupUrl", c.backupUrl)
        .putString("instanceId", c.instanceId).putString("token", c.token).apply()

    /** Signing out forgets the server and the token, but keeps how often the owner wants syncing. */
    fun clear(ctx: Context) {
        val keep = intervalMinutes(ctx)
        prefs(ctx).edit().clear().putInt("intervalMinutes", keep).apply()
    }

    // ---- how often the background sync runs

    const val DEFAULT_INTERVAL_MINUTES = 360

    /** Minutes between automatic syncs; 0 means only when asked. Android won't go below 15. */
    fun intervalMinutes(ctx: Context): Int = prefs(ctx).getInt("intervalMinutes", DEFAULT_INTERVAL_MINUTES)

    fun saveInterval(ctx: Context, minutes: Int) = prefs(ctx).edit().putInt("intervalMinutes", minutes).apply()

    /** Sets the background job up to match the saved interval (or removes it). Safe to call any time. */
    fun schedule(ctx: Context) {
        val work = WorkManager.getInstance(ctx)
        val minutes = intervalMinutes(ctx)
        if (config(ctx) == null || minutes <= 0) {
            work.cancelUniqueWork("sync")
            return
        }
        val request = PeriodicWorkRequestBuilder<SyncWorker>(maxOf(15, minutes).toLong(), TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        work.enqueueUniquePeriodicWork("sync", ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun lastStatus(ctx: Context): String = prefs(ctx).getString("status", "") ?: ""
    fun lastSyncAt(ctx: Context): Long = prefs(ctx).getLong("lastSyncAt", 0)
    private fun setStatus(ctx: Context, s: String) = prefs(ctx).edit().putString("status", s).apply()
    /** Nothing to read yet because the user hasn't allowed anything: not a failure. */
    class NoAccess : IllegalStateException("Allow Health Connect access first")

    fun recordError(ctx: Context, e: Throwable) =
        setStatus(ctx, if (e is NoAccess) "Waiting for Health Connect access" else "Failed: ${e.message ?: e.javaClass.simpleName}")

    // ---- running a sync

    /** Reads what's new and sends it. Returns the number of records sent. */
    suspend fun run(ctx: Context): Int {
        val cfg = config(ctx) ?: throw IllegalStateException("Not signed in")
        if (HealthConnectClient.getSdkStatus(ctx) != HealthConnectClient.SDK_AVAILABLE) {
            throw IllegalStateException("Health Connect unavailable")
        }
        val client = HealthConnectClient.getOrCreate(ctx)
        val granted = client.permissionController.getGrantedPermissions()
        val specs = SPECS.filter { it.permission in granted }
        if (specs.isEmpty()) throw NoAccess()

        val now = Instant.now()
        // Data synced before the app kept sleep segments is sent once more, so older nights can be drawn too.
        val last = if (prefs(ctx).getInt("dataVersion", 1) < DATA_VERSION) 0L else lastSyncAt(ctx)
        // The first sync goes as far back as the phone allows; later ones re-read a week to catch late data.
        val horizon = if (PERMISSION_HISTORY in granted) 90L else 30L
        val from = if (last == 0L) now.minus(horizon, ChronoUnit.DAYS)
        else maxOf(Instant.ofEpochMilli(last).minus(7, ChronoUnit.DAYS), now.minus(horizon, ChronoUnit.DAYS))

        var batch = JSONArray()
        var sent = 0
        val problems = mutableListOf<String>()
        // The server takes at most 5,000 records a request, and one data type can be far more than that
        // (months of heart rate), so send in slices.
        suspend fun flush() {
            var i = 0
            while (i < batch.length()) {
                val end = minOf(i + SLICE, batch.length())
                val slice = JSONArray()
                for (k in i until end) slice.put(batch.get(k))
                val body = JSONObject().put("records", slice).toString()
                withContext(Dispatchers.IO) { post(cfg, "/api/ingest", body) }
                sent += slice.length()
                i = end
            }
            batch = JSONArray()
        }
        for (s in specs) {
            try {
                s.read(client, from, now, batch)
            } catch (e: SecurityException) {
                problems += s.type // permission withdrawn mid-sync; carry on with the rest
            }
            if (batch.length() >= SLICE) flush()
        }
        flush()
        prefs(ctx).edit().putLong("lastSyncAt", now.toEpochMilli()).putInt("dataVersion", DATA_VERSION).apply()
        val tail = if (problems.isEmpty()) "" else " (skipped: ${problems.joinToString()})"
        setStatus(ctx, "Sent $sent records at ${java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(java.util.Date())}$tail")
        return sent
    }

    /**
     * On-device mode: the records of one data type from [sinceMs] (0 = as far back as the phone allows) to
     * [untilMs] (0 = now), returned to the app instead of sent anywhere. Empty if that type hasn't been allowed.
     */
    suspend fun readType(ctx: Context, type: String, sinceMs: Long, untilMs: Long = 0): JSONArray {
        val out = JSONArray()
        val spec = SPECS.firstOrNull { it.type == type } ?: return out
        if (HealthConnectClient.getSdkStatus(ctx) != HealthConnectClient.SDK_AVAILABLE) return out
        val client = HealthConnectClient.getOrCreate(ctx)
        val granted = client.permissionController.getGrantedPermissions()
        if (spec.permission !in granted) return out
        val now = Instant.now()
        val floor = now.minus(if (PERMISSION_HISTORY in granted) 90L else 30L, ChronoUnit.DAYS)
        val from = if (sinceMs <= 0) floor else maxOf(Instant.ofEpochMilli(sinceMs), floor)
        val to = if (untilMs <= 0) now else minOf(Instant.ofEpochMilli(untilMs), now)
        if (!from.isBefore(to)) return out
        try {
            spec.read(client, from, to, out)
        } catch (e: SecurityException) {
            // allowed a moment ago and withdrawn since: nothing to return
        }
        return out
    }

    // ---- talking to the server

    /** POSTs to the main address; if it can't be reached, to the local one, but only if it's the same server. */
    private fun post(cfg: Config, path: String, json: String) {
        try {
            http(cfg.url + path, cfg.token, json)
        } catch (e: IOException) {
            if (e is HttpError || cfg.backupUrl.isEmpty()) throw e
            val id = try { JSONObject(http(cfg.backupUrl + "/api/status", null, null)).optString("instance_id") } catch (_: Exception) { "" }
            if (cfg.instanceId.isEmpty() || id != cfg.instanceId) throw e
            http(cfg.backupUrl + path, cfg.token, json)
        }
    }

    class HttpError(val code: Int, detail: String = "") : IOException(
        when {
            code == 401 -> "The server didn't accept this phone's token. Open the app: it fixes it itself, or sign out and in again."
            detail.isNotEmpty() -> "Server returned HTTP $code: $detail"
            else -> "Server returned HTTP $code"
        }
    )

    /** FastAPI errors look like {"detail": "text"} or {"detail": [{"msg": "text", ...}]}. */
    private fun errorDetail(conn: HttpURLConnection): String = try {
        val body = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
        val d = JSONObject(body).opt("detail")
        when (d) {
            is String -> d
            is JSONArray -> if (d.length() > 0) d.getJSONObject(0).optString("msg") else ""
            else -> ""
        }.take(200)
    } catch (_: Exception) { "" }

    private fun http(url: String, token: String?, json: String?): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 10000
            conn.readTimeout = 60000
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            if (json != null) {
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(json.toByteArray()) }
            }
            val code = conn.responseCode
            if (code !in 200..299) throw HttpError(code, errorDetail(conn))
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }
}
