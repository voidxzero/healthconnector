package app.healthconnector

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.io.IOException

/** The scheduled sync: runs about every six hours, with or without the app open. */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = try {
        HcSync.run(applicationContext)
        Result.success()
    } catch (e: HcSync.HttpError) {
        HcSync.recordError(applicationContext, e)
        if (e.code in 500..599) Result.retry() else Result.failure()
    } catch (e: IOException) {
        HcSync.recordError(applicationContext, e)
        Result.retry() // the server couldn't be reached: try again later
    } catch (e: Exception) {
        HcSync.recordError(applicationContext, e)
        Result.failure()
    }
}
