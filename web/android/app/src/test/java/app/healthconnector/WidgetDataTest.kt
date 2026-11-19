package app.healthconnector

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

/** The widget's daily numbers must match the server's and the app's (same cases as web/src/lib/localdata.test.ts). */
class WidgetDataTest {
    private val today = LocalDate.of(2026, 11, 18)
    private fun rec(start: String, value: Double?, source: String = "a", end: String = start) =
        JSONObject().put("start", start).put("end", end).put("source", source).also { if (value != null) it.put("value", value) else it.put("value", JSONObject.NULL) }
    private fun list(vararg r: JSONObject) = JSONArray().also { a -> r.forEach { a.put(it) } }

    @Test
    fun sumsADayAndTakesTheLargerSourceRatherThanAddingPhoneAndWatch() {
        val out = WidgetData.aggregate(
            list(rec("2026-11-17T10:00:00Z", 1000.0, "watch"), rec("2026-11-17T12:00:00Z", 500.0, "watch"), rec("2026-11-17T10:00:00Z", 900.0, "phone")),
            "sum", false, ZoneOffset.UTC, today, 5,
        )
        assertEquals(1, out.size)
        assertEquals(LocalDate.of(2026, 11, 17), out[0].date)
        assertEquals(1500.0, out[0].value, 1e-9)
        assertEquals(3, out[0].count)
    }

    @Test
    fun averagesOtherTypesAndReportsTheRange() {
        val out = WidgetData.aggregate(list(rec("2026-11-17T10:00:00Z", 60.0), rec("2026-11-17T10:05:00Z", 80.0)), "avg", false, ZoneOffset.UTC, today, 5)
        assertEquals(70.0, out[0].value, 1e-9)
        assertEquals(60.0, out[0].min, 1e-9)
        assertEquals(80.0, out[0].max, 1e-9)
        assertEquals(2, out[0].count)
    }

    @Test
    fun putsSleepOnTheDayItEnds() {
        val sleep = rec("2026-11-17T22:30:00Z", 450.0, end = "2026-11-18T06:30:00Z")
        assertEquals(LocalDate.of(2026, 11, 18), WidgetData.aggregate(list(sleep), "sum", true, ZoneOffset.UTC, today, 3)[0].date)
        // starting day when not counted by its end
        assertEquals(LocalDate.of(2026, 11, 17), WidgetData.aggregate(list(sleep), "sum", false, ZoneOffset.UTC, today, 3)[0].date)
    }

    @Test
    fun groupsByLocalDay() {
        val steps = rec("2026-11-17T23:30:00Z", 100.0)
        assertEquals(LocalDate.of(2026, 11, 18), WidgetData.aggregate(list(steps), "sum", false, ZoneOffset.ofHours(2), today, 5)[0].date)
        assertEquals(LocalDate.of(2026, 11, 17), WidgetData.aggregate(list(steps), "sum", false, ZoneId.of("America/Chicago"), today, 5)[0].date)
    }

    @Test
    fun leavesOutDaysBeforeTheRangeAndKeepsDaysSorted() {
        val out = WidgetData.aggregate(
            list(rec("2026-11-10T10:00:00Z", 5.0), rec("2026-11-18T10:00:00Z", 7.0), rec("2026-11-16T10:00:00Z", 1.0)),
            "sum", false, ZoneOffset.UTC, today, 3,
        )
        assertEquals(listOf(LocalDate.of(2026, 11, 16), LocalDate.of(2026, 11, 18)), out.map { it.date })
    }

    @Test
    fun aMissingValueAddsNothingToASum() {
        val out = WidgetData.aggregate(list(rec("2026-11-17T10:00:00Z", null), rec("2026-11-17T11:00:00Z", 5.0)), "sum", false, ZoneOffset.UTC, today, 5)
        assertEquals(5.0, out[0].value, 1e-9)
        assertEquals(2, out[0].count)
    }

    // ---- the value scale, as in web/src/lib/metrics.test.ts

    private val sleep = listOf(Stop(300.0, "red", "Too little"), Stop(360.0, "amber", "A bit short"), Stop(420.0, "green", "Healthy"), Stop(540.0, "green", "Healthy"), Stop(600.0, "blue", "Long"))
    private val tone = { t: String -> mapOf("red" to 0xFFD03B3B.toInt(), "amber" to 0xFFFAB219.toInt(), "green" to 0xFF0CA30C.toInt(), "blue" to 0xFF3987E5.toInt())[t]!! }

    @Test
    fun theScaleIsRedAmberGreenThenBlue() {
        assertEquals(tone("red"), WidgetRenderer.scaleColor(sleep, 240.0, tone))
        assertEquals(tone("amber"), WidgetRenderer.scaleColor(sleep, 360.0, tone))
        assertEquals(tone("green"), WidgetRenderer.scaleColor(sleep, 450.0, tone))
        assertEquals(tone("blue"), WidgetRenderer.scaleColor(sleep, 700.0, tone))
        // between two stops it is a blend, not either end
        val mid = WidgetRenderer.scaleColor(sleep, 390.0, tone)
        assertNotEquals(tone("amber"), mid)
        assertNotEquals(tone("green"), mid)
    }

    @Test
    fun everyValueGetsAWord() {
        assertEquals("Too little", WidgetRenderer.scaleLabel(sleep, 240.0))
        assertEquals("A bit short", WidgetRenderer.scaleLabel(sleep, 354.0))
        assertEquals("Healthy", WidgetRenderer.scaleLabel(sleep, 480.0))
        assertEquals("Long", WidgetRenderer.scaleLabel(sleep, 660.0))
    }

    @Test
    fun formatsLikeTheApp() {
        val info = MetricInfo("sleep", "Sleep", "sum", true, 1 / 60.0, 0.0, 1, "h", 0, 0, "moon", "sleep", true, null)
        assertEquals("7h 30m", WidgetRenderer.valueText(info, 450.0).first)
        val weight = MetricInfo("weight", "Weight", "avg", false, 2.2046226, 0.0, 1, "lb", 0, 0, "scale", "body", false, null)
        assertTrue(WidgetRenderer.valueText(weight, 80.0).first.startsWith("176"))
    }
}
