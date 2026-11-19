package app.healthconnector

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.RelativeSizeSpan
import android.util.TypedValue
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.cbrt
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/** Draws one widget: the metric's icon and name, its latest value, and a small chart. */
object WidgetRenderer {
    fun isNight(ctx: Context) = (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    // ---- the same number formatting as the app (web/src/lib/metrics.ts `fmt`)

    private fun number(v: Double, digits: Int): String =
        NumberFormat.getNumberInstance().apply { maximumFractionDigits = digits; minimumFractionDigits = 0 }.format(v)

    private fun hm(minutes: Double): String {
        val m = minutes.roundToInt()
        return if (m >= 60) "${m / 60}h ${(m % 60).toString().padStart(2, '0')}m" else "${m}m"
    }

    fun valueText(info: MetricInfo, stored: Double): Pair<String, String> =
        if (info.duration) hm(stored) to "" else number(stored * info.a + info.b, info.digits) to info.unit

    // ---- the value scale (web/src/lib/metrics.ts `scaleColor` / `scaleLabel`); blended in Oklab like the app's color-mix

    private class Lab(val l: Double, val a: Double, val b: Double)

    private fun toLab(c: Int): Lab {
        fun lin(x: Int) = (x / 255.0).let { if (it <= 0.04045) it / 12.92 else ((it + 0.055) / 1.055).pow(2.4) }
        val r = lin((c shr 16) and 0xFF); val g = lin((c shr 8) and 0xFF); val bl = lin(c and 0xFF)
        val l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl)
        val m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl)
        val s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl)
        return Lab(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)
    }

    private fun fromLab(x: Lab): Int {
        val l = (x.l + 0.3963377774 * x.a + 0.2158037573 * x.b).pow(3)
        val m = (x.l - 0.1055613458 * x.a - 0.0638541728 * x.b).pow(3)
        val s = (x.l - 0.0894841775 * x.a - 1.2914855480 * x.b).pow(3)
        fun enc(v: Double): Int {
            val c = if (v <= 0.0031308) 12.92 * v else 1.055 * v.pow(1 / 2.4) - 0.055
            return (c.coerceIn(0.0, 1.0) * 255).roundToInt()
        }
        val r = enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
        val g = enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
        val b = enc(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }

    private fun blend(c1: Int, c2: Int, t: Double): Int {
        val a = toLab(c1); val b = toLab(c2)
        return fromLab(Lab(a.l + (b.l - a.l) * t, a.a + (b.a - a.a) * t, a.b + (b.b - a.b) * t))
    }

    fun scaleColor(stops: List<Stop>, v: Double, tone: (String) -> Int): Int {
        if (v <= stops.first().at) return tone(stops.first().tone)
        if (v >= stops.last().at) return tone(stops.last().tone)
        val i = stops.indices.first { v >= stops[it].at && v <= stops[it + 1].at }
        val a = stops[i]; val b = stops[i + 1]
        val keep = ((1 - (v - a.at) / (b.at - a.at)) * 100).roundToInt()
        return when {
            keep >= 100 -> tone(a.tone)
            keep <= 0 -> tone(b.tone)
            else -> blend(tone(a.tone), tone(b.tone), 1 - keep / 100.0)
        }
    }

    fun scaleLabel(stops: List<Stop>, v: Double): String = stops.minByOrNull { abs(v - it.at) }!!.label

    // ---- the chart

    private fun niceMax(v: Double): Double {
        if (v <= 0) return 1.0
        val p = 10.0.pow(kotlin.math.floor(kotlin.math.log10(v)))
        val f = v / p
        return (if (f <= 1) 1.0 else if (f <= 2) 2.0 else if (f <= 5) 5.0 else 10.0) * p
    }

    fun chart(
        ctx: Context, widthPx: Int, heightPx: Int, series: List<DayValue>, days: Int, cfg: WidgetConfig, info: MetricInfo, catalog: Catalog,
    ): Bitmap {
        val night = isNight(ctx)
        val d = ctx.resources.displayMetrics.density
        val bmp = Bitmap.createBitmap(max(1, widthPx), max(1, heightPx), Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val grid = ContextCompat.getColor(ctx, R.color.widget_grid)
        val muted = ContextCompat.getColor(ctx, R.color.widget_text2)
        val base = if (night) info.colorDark else info.colorLight
        val rated = cfg.rated && info.stops != null
        val colorFor = { v: Double -> if (rated) scaleColor(info.stops!!, v) { catalog.tone(it, night) } else base }

        val top = 6 * d
        val bottom = heightPx - 2 * d
        val plotH = bottom - top
        val w = widthPx.toFloat()
        val slot = w / days
        val x = { i: Int -> (i + 0.5f) * slot }
        val first = LocalDate.now().minusDays((days - 1).toLong())
        val byIdx = series.associateBy { java.time.temporal.ChronoUnit.DAYS.between(first, it.date).toInt() }.filterKeys { it in 0 until days }
        if (byIdx.isEmpty()) return bmp

        val vals = byIdx.values.map { it.value * info.a + info.b }
        val zero = cfg.kind == "bar" || info.kind == "sum"
        var lo = if (zero) 0.0 else vals.min()
        var hi = vals.max()
        if (zero) hi = niceMax(hi) else { val pad = (hi - lo) * 0.15; val p = if (pad > 0) pad else abs(hi) * 0.05 + 1.0; lo -= p; hi += p }
        if (hi <= lo) hi = lo + 1
        val y = { v: Double -> (bottom - (v - lo) / (hi - lo) * plotH).toFloat() }

        val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = grid; strokeWidth = d; style = Paint.Style.STROKE }
        for (k in 0..2) { val gy = (top + plotH * k / 2.0).toFloat(); c.drawLine(0f, gy, w, gy, gridPaint) }

        if (cfg.kind == "bar") {
            val bw = min(slot * 0.7f, 24 * d).coerceAtLeast(1f)
            val r = min(4 * d, bw / 2)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            for ((i, day) in byIdx) {
                paint.color = colorFor(day.value)
                val yt = y(day.value * info.a + info.b)
                val h = bottom - yt
                val rr = min(r, max(0f, h))
                val path = Path().apply { addRoundRect(RectF(x(i) - bw / 2, yt, x(i) + bw / 2, bottom.toFloat()), floatArrayOf(rr, rr, rr, rr, 0f, 0f, 0f, 0f), Path.Direction.CW) }
                c.drawPath(path, paint)
            }
        } else {
            val pts = byIdx.toSortedMap().map { (i, day) -> x(i) to y(day.value * info.a + info.b) }
            val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE; strokeWidth = 2 * d; strokeJoin = Paint.Join.ROUND; strokeCap = Paint.Cap.ROUND; color = base
                if (rated) {
                    // The line takes the colour of the height it is at, like the app's gradient.
                    val st = info.stops!!.sortedByDescending { it.at }
                    shader = LinearGradient(0f, top, 0f, bottom.toFloat(), st.map { scaleColor(info.stops, it.at) { t -> catalog.tone(t, night) } }.toIntArray(),
                        st.map { ((y(it.at * info.a + info.b) - top) / plotH).coerceIn(0f, 1f) }.toFloatArray(), Shader.TileMode.CLAMP)
                }
            }
            val path = Path()
            pts.forEachIndexed { k, (px, py) -> if (k == 0) path.moveTo(px, py) else path.lineTo(px, py) }
            c.drawPath(path, line)
            val (lx, ly) = pts.last()
            c.drawCircle(lx, ly, 4 * d, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = colorFor(byIdx.toSortedMap().lastEntry()!!.value.value) })
        }

        return bmp
    }

    // ---- the whole widget

    fun render(ctx: Context, id: Int, cfg: WidgetConfig, catalog: Catalog?, series: List<DayValue>?, widthDp: Int, heightDp: Int, message: String?): RemoteViews {
        val rv = RemoteViews(ctx.packageName, R.layout.widget_metric)
        val info = catalog?.metrics?.get(cfg.metric)
        val night = isNight(ctx)

        // tapping opens the app on the right screen
        val open = Intent(ctx, MainActivity::class.java).putExtra("route", info?.tab ?: "overview").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        rv.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))

        if (info == null) {
            rv.setTextViewText(R.id.label, "HealthConnector")
            rv.setTextViewText(R.id.value, "Open the app")
            rv.setTextViewText(R.id.sub, message ?: "to finish setting up this widget")
            rv.setViewVisibility(R.id.chart, android.view.View.GONE)
            rv.setViewVisibility(R.id.axis, android.view.View.GONE)
            rv.setViewVisibility(R.id.icon, android.view.View.GONE)
            return rv
        }

        val tint = if (night) info.colorDark else info.colorLight
        rv.setViewVisibility(R.id.icon, android.view.View.VISIBLE)
        val iconRes = ctx.resources.getIdentifier("ic_m_${info.icon}", "drawable", ctx.packageName)
        if (iconRes != 0) { rv.setImageViewResource(R.id.icon, iconRes); rv.setInt(R.id.icon, "setColorFilter", tint) }
        rv.setTextViewText(R.id.label, info.label)

        val latest = series?.lastOrNull()
        val showChart = cfg.style != "number" && message == null && !series.isNullOrEmpty()
        val bigValue = cfg.style != "chart"

        when {
            message != null -> {
                rv.setTextViewText(R.id.value, "—")
                rv.setTextViewText(R.id.sub, message)
            }
            latest == null -> {
                rv.setTextViewText(R.id.value, "—")
                rv.setTextViewText(R.id.sub, "No data in the last ${cfg.days} days")
            }
            else -> {
                val (num, unit) = valueText(info, latest.value)
                val sb = SpannableStringBuilder(num)
                if (unit.isNotEmpty()) { sb.append(' '); val s = sb.length; sb.append(unit); sb.setSpan(RelativeSizeSpan(0.5f), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
                rv.setTextViewText(R.id.value, sb)
                val today = LocalDate.now()
                val whenText = when {
                    info.key == "sleep" && !latest.date.isBefore(today.minusDays(1)) -> "Last night"
                    latest.date == today -> "Today"
                    latest.date == today.minusDays(1) -> "Yesterday"
                    else -> latest.date.format(DateTimeFormatter.ofPattern("MMM d"))
                }
                val zone = if (cfg.rated && info.stops != null) " · ${scaleLabel(info.stops, latest.value)}" else ""
                rv.setTextViewText(R.id.sub, whenText + zone)
            }
        }
        rv.setTextViewTextSize(R.id.value, TypedValue.COMPLEX_UNIT_SP, if (bigValue) 28f else 18f)
        rv.setViewVisibility(R.id.value, android.view.View.VISIBLE)

        if (showChart && catalog != null) {
            val d = ctx.resources.displayMetrics.density
            // What's left of the widget once its padding, heading, number, caption and date row have their share.
            val chartW = ((widthDp - 24).coerceAtLeast(60) * d).toInt().coerceAtMost(900)
            val used = if (bigValue) 24 + 20 + 52 + 8 + 14 else 24 + 20 + 40 + 8 + 14
            val chartH = ((heightDp - used).coerceAtLeast(36) * d).toInt().coerceAtMost(500)
            val fmt = DateTimeFormatter.ofPattern("MMM d")
            rv.setTextViewText(R.id.axisStart, LocalDate.now().minusDays((cfg.days - 1).toLong()).format(fmt))
            rv.setTextViewText(R.id.axisEnd, LocalDate.now().format(fmt))
            rv.setViewVisibility(R.id.axis, android.view.View.VISIBLE)
            rv.setImageViewBitmap(R.id.chart, chart(ctx, chartW, chartH, series!!, cfg.days, cfg, info, catalog))
            rv.setViewVisibility(R.id.chart, android.view.View.VISIBLE)
        } else {
            rv.setViewVisibility(R.id.chart, android.view.View.GONE)
            rv.setViewVisibility(R.id.axis, android.view.View.GONE)
        }
        return rv
    }
}
