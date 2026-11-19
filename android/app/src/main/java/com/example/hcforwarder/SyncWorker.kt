package com.example.hcforwarder

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.io.IOException

class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = try {
        Sync.run(applicationContext)
        Result.success()
    } catch (e: IOException) {
        Sync.recordError(applicationContext, e)
        Result.retry() // network trouble: try again later
    } catch (e: Exception) {
        Sync.recordError(applicationContext, e)
        Result.failure()
    }
}
