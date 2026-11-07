package ru.arseniy.move;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.time.ZoneId;
import java.time.LocalDate;
import java.util.TreeSet;

final class ReminderScheduler {
    static final String ACTION = "ru.arseniy.move.TRAINING_REMINDER";
    private static final String PREFS = "move-reminders-v1";
    private static final String CHANNEL = "training-reminders";
    private static final int REQUEST = 4201, NOTIFICATION = 4202;
    private ReminderScheduler() { }

    static final class Config {
        final boolean enabled;
        final int[] days;
        final String time;
        Config(boolean enabled, int[] days, String time) { this.enabled = enabled; this.days = days; this.time = time; }
        static Config off() { return new Config(false, new int[0], ""); }
        static Config parse(JSONObject input) throws JSONException {
            if (!(input.opt("enabled") instanceof Boolean)) throw new IllegalArgumentException("Boolean enabled required");
            boolean enabled = input.getBoolean("enabled");
            if (!enabled && !input.has("days") && !input.has("time")) return off();
            JSONArray raw = input.optJSONArray("days");
            String time = input.optString("time", "");
            if (raw == null || raw.length() > 7 || (enabled && raw.length() == 0)
                || !time.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]")) throw new IllegalArgumentException("Valid days and time required");
            TreeSet<Integer> selected = new TreeSet<>();
            for (int i = 0; i < raw.length(); i++) {
                Object item = raw.get(i);
                if (!(item instanceof Number)) throw new IllegalArgumentException("ISO weekday required");
                double value = ((Number)item).doubleValue();
                int day = ((Number)item).intValue();
                if (day < 1 || day > 7 || value != day) throw new IllegalArgumentException("ISO weekday required");
                selected.add(day);
            }
            int[] days = new int[selected.size()];
            int i = 0;
            for (int day : selected) days[i++] = day;
            return new Config(enabled, days, time);
        }
        JSONObject json() {
            JSONObject result = new JSONObject();
            try {
                JSONArray list = new JSONArray();
                for (int day : days) list.put(day);
                result.put("enabled", enabled).put("days", list).put("time", time);
            } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
            return result;
        }
    }

    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    static void initializeMorningReminder(Context context) {
        SharedPreferences saved = prefs(context);
        if (saved.getBoolean("training108Configured", false)) return;
        // Parent requested daily 07:00/19:00 and weekend 14:00 in 1.0.8. Apply once to fresh installs
        // and upgrades; later user-selected times or disabling are never overwritten.
        Config morning = new Config(true, new int[]{1, 2, 3, 4, 5, 6, 7}, "07:00");
        saved.edit().putString("config", morning.json().toString())
            .putBoolean("training108Configured", true).commit();
    }
    static Config load(Context context) {
        String raw = prefs(context).getString("config", null);
        if (raw == null) return Config.off();
        try {
            JSONObject parsed = new JSONObject(raw);
            if (!parsed.optBoolean("enabled") && parsed.optString("time").isEmpty()) return Config.off();
            return Config.parse(parsed);
        } catch (JSONException | IllegalArgumentException malformed) { return Config.off(); }
    }
    static void save(Context context, Config config) {
        // Commit the explicit preference before enabling a background alarm.
        if (!prefs(context).edit().putString("config", config.json().toString()).commit())
            throw new IllegalStateException("Reminder settings could not be saved");
    }
    static void ensureChannel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Напоминания о разминке", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Только в выбранные тобой дни. Время приблизительное.");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
    }
    static boolean permissionGranted(Context context) {
        return Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }
    static boolean notificationsAvailable(Context context) {
        if (!permissionGranted(context)) return false;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return false;
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }
    private static PendingIntent alarmIntent(Context context, long at) {
        Intent intent = new Intent(context, ReminderReceiver.class).setAction(ACTION).putExtra("scheduledAt", at);
        return PendingIntent.getBroadcast(context, REQUEST, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static void cancel(Context context) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms != null) alarms.cancel(alarmIntent(context, 0));
        prefs(context).edit().putLong("nextAt", 0).apply();
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        if (notifications != null) notifications.cancel(NOTIFICATION);
    }
    static String rearm(Context context) {
        Config config = load(context);
        if (!config.enabled) { cancel(context); return "disabled"; }
        ensureChannel(context);
        if (!permissionGranted(context)) { cancel(context); return "permission_required"; }
        if (!notificationsAvailable(context)) { cancel(context); return "notifications_blocked"; }
        long next = ReminderTime.nextTraining(System.currentTimeMillis(), ZoneId.systemDefault());
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (next == 0 || alarms == null) { cancel(context); return "unavailable"; }
        try {
            // Inexact and battery-aware. No SCHEDULE_EXACT_ALARM/USE_EXACT_ALARM permission.
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarmIntent(context, next));
            prefs(context).edit().putLong("nextAt", next).apply();
            return "scheduled";
        } catch (RuntimeException unavailable) { cancel(context); return "unavailable"; }
    }
    static JSONObject status(Context context, String outcome) {
        JSONObject result = load(context).json();
        try {
            long next = prefs(context).getLong("nextAt", 0);
            result.put("status", outcome).put("active", load(context).enabled && notificationsAvailable(context) && next > 0)
                .put("nextAt", next).put("precision", "inexact").put("timezone", ZoneId.systemDefault().getId())
                .put("notificationPermission", permissionGranted(context)).put("notificationsAvailable", notificationsAvailable(context));
        } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        return result;
    }
    static JSONObject capabilities(Context context) {
        JSONObject result = new JSONObject();
        try {
            result.put("available", true).put("platform", "android").put("version", 2)
                .put("camera", context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY))
                .put("cameraPermission", context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
                .put("imageShare", true).put("imageSave", false).put("localProcessing", true).put("nativeReminders", true)
                .put("reminder", status(context, "current"));
        } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        return result;
    }
    static void onAlarm(Context context, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        Config config = load(context);
        long expected = prefs(context).getLong("nextAt", 0);
        long requested = intent.getLongExtra("scheduledAt", 0);
        long now = System.currentTimeMillis();
        boolean due = expected > 0 && requested == expected && now >= expected - 30000L && now - expected < 6L * 60 * 60 * 1000;
        if (config.enabled && due && notificationsAvailable(context)) {
            ensureChannel(context);
            Intent open = new Intent(context, MainActivity.class).setAction(Intent.ACTION_MAIN)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("fromReminder", true);
            PendingIntent launch = PendingIntent.getActivity(context, REQUEST + 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            int icon = context.getResources().getIdentifier("ic_notification", "drawable", context.getPackageName());
            String[] titles = {"Арсений, пора размяться?", "Арсений, время движения!", "Ещё шаг к новому уровню", "Время короткой тренировки"};
            String[] messages = {
                "Короткая тренировка — ещё шаг к новому уровню. Поднимем твой рейтинг?",
                "Начни с разминки. Выбери упражнение и занимайся в своём темпе.",
                "Выбери упражнение и двигайся в своём темпе. Твои достижения ждут!",
                "Несколько спокойных минут движения — перерыв с пользой. Готов попробовать?"
            };
            int motivation = LocalDate.now(ZoneId.systemDefault()).getDayOfYear() % messages.length;
            Notification notification = new Notification.Builder(context, CHANNEL).setSmallIcon(icon)
                .setContentTitle(titles[motivation])
                .setContentText(messages[motivation])
                .setStyle(new Notification.BigTextStyle().bigText(messages[motivation]))
                .setContentIntent(launch).setAutoCancel(true).setCategory(Notification.CATEGORY_REMINDER)
                .setVisibility(Notification.VISIBILITY_PRIVATE).build();
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            try { if (manager != null) manager.notify(NOTIFICATION, notification); }
            catch (SecurityException revoked) { /* Permission can be revoked between the check and notify. */ }
        }
        rearm(context);
    }
}
