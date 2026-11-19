package app.healthconnector

import android.content.Context
import org.json.JSONObject

private const val PREFS = "widgets"

/** One shade of the value scale: from [at] (stored units) on the colour is [tone], blending to the next stop. */
class Stop(val at: Double, val tone: String, val label: String)

/**
 * What the widget needs to know about a metric to show it the way the app does: its name, how stored values become
 * displayed ones (a straight line: value * [a] + [b]), its colour, and its value scale. The app pushes all of this
 * (web/src/lib/widgets.ts) so the units, colours and thresholds stay defined in one place.
 */
class MetricInfo(
    val key: String,
    val label: String,
    /** "sum" adds up over a day, "avg" averages. */
    val kind: String,
    val duration: Boolean,
    val a: Double,
    val b: Double,
    val digits: Int,
    val unit: String,
    val colorLight: Int,
    val colorDark: Int,
    val icon: String,
    /** Which screen of the app a tap opens. */
    val tab: String,
    /** Counted on the day it ends (sleep) rather than the day it starts. */
    val byEnd: Boolean,
    val stops: List<Stop>?,
)

class Catalog(val metrics: Map<String, MetricInfo>, val tones: Map<String, Pair<Int, Int>>) {
    fun tone(name: String, night: Boolean): Int = tones[name]?.let { if (night) it.second else it.first } ?: 0xFF888888.toInt()
}

object WidgetCatalog {
    fun save(ctx: Context, json: String) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("catalog", json).apply()

    fun load(ctx: Context): Catalog? {
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("catalog", null) ?: return null
        return try {
            val root = JSONObject(raw)
            val tonesJson = root.getJSONObject("tones")
            val tones = tonesJson.keys().asSequence().associateWith {
                val t = tonesJson.getJSONObject(it)
                color(t.getString("light")) to color(t.getString("dark"))
            }
            val ms = root.getJSONObject("metrics")
            val metrics = ms.keys().asSequence().associateWith { key ->
                val m = ms.getJSONObject(key)
                val stopsJson = m.optJSONArray("stops")
                MetricInfo(
                    key = key,
                    label = m.getString("label"),
                    kind = m.getString("kind"),
                    duration = m.optBoolean("duration"),
                    a = m.getDouble("a"),
                    b = m.getDouble("b"),
                    digits = m.getInt("digits"),
                    unit = m.optString("unit"),
                    colorLight = color(m.getString("colorLight")),
                    colorDark = color(m.getString("colorDark")),
                    icon = m.optString("icon"),
                    tab = m.optString("tab", "overview"),
                    byEnd = m.optBoolean("byEnd"),
                    stops = stopsJson?.let { arr -> (0 until arr.length()).map { i -> arr.getJSONObject(i).let { s -> Stop(s.getDouble("at"), s.getString("tone"), s.getString("label")) } } },
                )
            }
            Catalog(metrics, tones)
        } catch (e: Exception) {
            null
        }
    }

    private fun color(hex: String): Int = android.graphics.Color.parseColor(hex)
}

/** How one widget on the home screen was set up. */
class WidgetConfig(
    val metric: String,
    /** "both" = number and chart, "number", or "chart". */
    val style: String = "both",
    /** "bar" or "line". */
    val kind: String = "bar",
    val days: Int = 7,
    /** Colour by value, where the metric has a scale. */
    val rated: Boolean = true,
) {
    fun toJson(): String = JSONObject().put("metric", metric).put("style", style).put("kind", kind).put("days", days).put("rated", rated).toString()

    companion object {
        fun fromJson(s: String): WidgetConfig? = try {
            val j = JSONObject(s)
            WidgetConfig(j.getString("metric"), j.optString("style", "both"), j.optString("kind", "bar"), j.optInt("days", 7), j.optBoolean("rated", true))
        } catch (e: Exception) {
            null
        }

        private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        fun load(ctx: Context, id: Int): WidgetConfig? = prefs(ctx).getString("w$id", null)?.let { fromJson(it) }
        fun save(ctx: Context, id: Int, c: WidgetConfig) = prefs(ctx).edit().putString("w$id", c.toJson()).apply()
        fun delete(ctx: Context, id: Int) = prefs(ctx).edit().remove("w$id").apply()
    }
}
