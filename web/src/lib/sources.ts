/** What the apps that usually write to Health Connect are called; anything else shows its package name. */
const KNOWN: Record<string, string> = {
  'com.google.android.apps.fitness': 'Google Fit',
  'com.fitbit.FitbitMobile': 'Fitbit',
  'com.sec.android.app.shealth': 'Samsung Health',
  'com.garmin.android.apps.connectmobile': 'Garmin Connect',
  'com.ouraring.oura': 'Oura',
  'com.withings.wiscale2': 'Withings',
  'com.google.android.apps.healthdata': 'Health Connect',
  'com.google.android.wearable.app': 'Wear OS',
  'com.xiaomi.wearable': 'Zepp / Mi Fitness',
  'com.huawei.health': 'Huawei Health',
  'com.polar.polarflow': 'Polar Flow',
  'com.strava': 'Strava',
  'com.myfitnesspal.android': 'MyFitnessPal',
  'app.healthconnector': 'HealthConnector (test data)',
};

export const sourceName = (pkg: string) => KNOWN[pkg] ?? pkg;
