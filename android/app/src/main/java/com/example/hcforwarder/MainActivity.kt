package com.example.hcforwarder

import android.os.Bundle
import android.net.Uri
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.android.material.button.MaterialButton
import com.google.android.material.progressindicator.LinearProgressIndicator
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {
    private lateinit var url: TextInputEditText
    private lateinit var token: TextInputEditText
    private lateinit var urlLayout: TextInputLayout
    private lateinit var statusTitle: TextView
    private lateinit var statusDetail: TextView
    private lateinit var progress: LinearProgressIndicator
    private lateinit var save: MaterialButton
    private lateinit var syncNow: MaterialButton

    private val requestPermissions = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { granted ->
        if (granted.contains(Sync.PERMISSIONS.first())) {
            show("Connected", "Sleep access granted. Syncing about every 6 hours.")
        } else {
            show("Permission needed", "Allow Health Connector to read sleep data, then tap Save and connect again.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContentView(R.layout.activity_main)

        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(0, bars.top, 0, bars.bottom)
            insets
        }

        url = findViewById(R.id.url)
        token = findViewById(R.id.token)
        urlLayout = findViewById(R.id.urlLayout)
        statusTitle = findViewById(R.id.statusTitle)
        statusDetail = findViewById(R.id.statusDetail)
        progress = findViewById(R.id.progress)
        save = findViewById(R.id.save)
        syncNow = findViewById(R.id.syncNow)

        url.setText(Sync.url(this))
        token.setText(Sync.token(this))
        token.setOnEditorActionListener { _, id, _ ->
            if (id == EditorInfo.IME_ACTION_DONE) { save.performClick(); true } else false
        }

        findViewById<MaterialButton>(R.id.scan).setOnClickListener { onScan() }
        save.setOnClickListener { onSave() }
        syncNow.setOnClickListener { onSyncNow() }

        if (Sync.url(this).isEmpty()) show("Not set up", "Enter your server URL and token below.")
        else show("Ready", Sync.lastStatus(this))
    }

    private fun show(title: String, detail: String) {
        statusTitle.text = title
        statusDetail.text = detail
    }

    private fun persist(): Boolean {
        val u = url.text.toString().trim()
        if (!(u.startsWith("http://") || u.startsWith("https://"))) {
            urlLayout.error = "Must start with http:// or https://"
            return false
        }
        urlLayout.error = null
        Sync.save(this, u, token.text.toString())
        return true
    }

    /** Reads hcconnect://setup?url=...&token=... from the web app's QR code. */
    private fun onScan() {
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build()
        GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { code ->
                val uri = Uri.parse(code.rawValue ?: "")
                val u = uri.getQueryParameter("url")
                val t = uri.getQueryParameter("token")
                if (uri.scheme != "hcconnect" || u.isNullOrEmpty() || t.isNullOrEmpty()) {
                    show("Unrecognised QR code", "Use the QR code shown by Add device in the web app.")
                } else {
                    url.setText(u)
                    token.setText(t)
                    show("Scanned", "Tap Save and connect to finish.")
                }
            }
            .addOnFailureListener { e ->
                show("Scan failed", e.message ?: "Could not open the scanner. Paste the URL and token instead.")
            }
    }

    private fun onSave() {
        if (!persist()) return
        schedule()
        when (HealthConnectClient.getSdkStatus(this)) {
            HealthConnectClient.SDK_AVAILABLE -> lifecycleScope.launch {
                val granted = HealthConnectClient.getOrCreate(this@MainActivity)
                    .permissionController.getGrantedPermissions()
                if (granted.containsAll(Sync.PERMISSIONS)) {
                    show("Connected", "Settings saved. Syncing about every 6 hours.")
                } else {
                    requestPermissions.launch(Sync.PERMISSIONS)
                }
            }
            else -> show("Health Connect unavailable", "Install or update Health Connect, then try again.")
        }
    }

    private fun onSyncNow() {
        if (!persist()) return
        progress.visibility = View.VISIBLE
        syncNow.isEnabled = false
        show("Syncing…", "Reading sleep from Health Connect.")
        lifecycleScope.launch {
            try {
                val n = Sync.run(this@MainActivity)
                show("Sync complete", "Sent $n sleep session${if (n == 1) "" else "s"} to your server.")
            } catch (e: Exception) {
                Sync.recordError(this@MainActivity, e)
                show("Sync failed", Sync.lastStatus(this@MainActivity).removePrefix("Error: "))
            } finally {
                progress.visibility = View.GONE
                syncNow.isEnabled = true
            }
        }
    }

    private fun schedule() {
        val req = PeriodicWorkRequestBuilder<SyncWorker>(6, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(this)
            .enqueueUniquePeriodicWork("sync", ExistingPeriodicWorkPolicy.UPDATE, req)
    }
}
