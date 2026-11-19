package app.healthconnector;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins have to be registered before the bridge starts.
        registerPlugin(HealthConnectPlugin.class);
        registerPlugin(HapticsPlugin.class);
        registerPlugin(WidgetsPlugin.class);
        registerPlugin(UpdaterPlugin.class);
        rememberRoute(getIntent());
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        rememberRoute(intent); // a widget was tapped while the app was already open
    }

    /** A tapped widget names the screen it wants; the web app picks it up when it comes into view. */
    private void rememberRoute(Intent intent) {
        if (intent != null && intent.hasExtra("route")) WidgetBridge.pendingRoute = intent.getStringExtra("route");
    }
}
