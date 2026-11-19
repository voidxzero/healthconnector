package com.example.hcforwarder

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit

/** Debug-only: writes 3 fake nights of sleep into Health Connect. Launch via adb. */
class SeedActivity : ComponentActivity() {
    private val write = HealthPermission.getWritePermission(SleepSessionRecord::class)

    private val request = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { if (write in it) seed() else finish() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycleScope.launch {
            val client = HealthConnectClient.getOrCreate(this@SeedActivity)
            if (write in client.permissionController.getGrantedPermissions()) seed()
            else request.launch(setOf(write))
        }
    }

    private fun seed() = lifecycleScope.launch {
        val client = HealthConnectClient.getOrCreate(this@SeedActivity)
        val today = Instant.now().truncatedTo(ChronoUnit.DAYS)
        val recs = (1..3).map { n ->
            val start = today.minus(n.toLong(), ChronoUnit.DAYS).plus(23, ChronoUnit.HOURS)
            val end = start.plus(7, ChronoUnit.HOURS).plus((n * 10).toLong(), ChronoUnit.MINUTES)
            SleepSessionRecord(
                startTime = start, startZoneOffset = ZoneOffset.UTC,
                endTime = end, endZoneOffset = ZoneOffset.UTC,
                title = "seed $n",
                stages = listOf(
                    SleepSessionRecord.Stage(start, start.plus(3, ChronoUnit.HOURS), SleepSessionRecord.STAGE_TYPE_LIGHT),
                    SleepSessionRecord.Stage(start.plus(3, ChronoUnit.HOURS), end, SleepSessionRecord.STAGE_TYPE_DEEP),
                ),
                metadata = Metadata.manualEntry(),
            )
        }
        client.insertRecords(recs)
        finish()
    }
}
