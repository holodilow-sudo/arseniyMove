package ru.arseniy.move;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;

/** Calendar-only weekly policy: ISO weekdays, device time zone, no exact-time claim. */
final class ReminderTime {
    private ReminderTime() { }

    static long nextTraining(long now, ZoneId zone) {
        int[] daily = {1,2,3,4,5,6,7};
        return Math.min(Math.min(next(daily, "07:00", now, zone),
            next(daily, "19:00", now, zone)),
            next(new int[]{6,7}, "14:00", now, zone));
    }

    static long next(int[] days, String time, long now, ZoneId zone) {
        if (days == null || days.length == 0 || time == null || !time.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]")) return 0;
        LocalDate today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate();
        LocalTime clock = LocalTime.parse(time);
        for (int offset = 0; offset <= 7; offset++) {
            LocalDate date = today.plusDays(offset);
            boolean chosen = false;
            for (int day : days) if (day == date.getDayOfWeek().getValue()) chosen = true;
            if (!chosen) continue;
            // atZone advances a missing DST time to the next valid time and picks
            // the earlier offset in a repeated hour: one reminder per chosen day.
            long candidate = date.atTime(clock).atZone(zone).toInstant().toEpochMilli();
            if (candidate > now + 1000L) return candidate;
        }
        return 0;
    }
}
