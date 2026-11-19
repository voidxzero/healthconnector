package app.healthconnector

import android.content.Context
import org.json.JSONArray
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** One day of a metric. */
class DayValue(val date: LocalDate, val value: Double, val min: Double, val max: Double, val count: Int)

/**
 * Per-day values for the widget, worked out the same way as the server and the app (app.py `daily`,
 * web/src/lib/localdata.ts `daily`): sums add up per day and take the largest single source (a phone and a watch
 * both count steps); everything else averages; sleep belongs to the day it ends. Keep the three in step.
 */
object WidgetData {
    fun aggregate(records: JSONArray, kind: String, byEnd: Boolean, zone: ZoneId, today: LocalDate, days: Int): List<DayValue> {
        val first = today.minusDays((days - 1).toLong())
        val sums = HashMap<LocalDate, HashMap<String, Double>>()
        val counts = HashMap<LocalDate, Int>()
        val values = HashMap<LocalDate, MutableList<Double>>()
        for (i in 0 until records.length()) {
            val r = records.getJSONObject(i)
            val at = if (byEnd) r.optString("end", r.getString("start")) else r.getString("start")
            val day = Instant.parse(at).atZone(zone).toLocalDate()
            if (day.isBefore(first) || day.isAfter(today)) continue
            counts[day] = (counts[day] ?: 0) + 1
            val v = if (r.isNull("value")) null else r.getDouble("value")
            if (kind == "sum") {
                val bySource = sums.getOrPut(day) { HashMap() }
                val src = r.optString("source", "")
                bySource[src] = (bySource[src] ?: 0.0) + (v ?: 0.0) // like SQL SUM, a missing value adds nothing
            } else if (v != null) {
                values.getOrPut(day) { ArrayList() }.add(v)
            }
        }
        return if (kind == "sum") {
            sums.map { (d, bySource) -> DayValue(d, bySource.values.max(), 0.0, 0.0, counts[d] ?: 0) }
        } else {
            values.map { (d, list) -> DayValue(d, list.average(), list.min(), list.max(), counts[d] ?: list.size) }
        }.sortedBy { it.date }
    }

    /** Reads Health Connect for the last [days] days and works out the per-day values. Empty if nothing is allowed or there's no data. */
    suspend fun series(ctx: Context, type: String, info: MetricInfo, days: Int): List<DayValue> {
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val since = today.minusDays((days - 1).toLong()).atStartOfDay(zone).toInstant().toEpochMilli()
        val records = HcSync.readType(ctx, type, since)
        return aggregate(records, info.kind, info.byEnd, zone, today, days)
    }
}
