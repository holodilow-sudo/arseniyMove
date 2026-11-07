package ru.arseniy.move;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Receives only the application's immutable explicit PendingIntent. */
public final class ReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) { ReminderScheduler.onAlarm(context, intent); }
}
