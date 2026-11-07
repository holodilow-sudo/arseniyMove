package ru.arseniy.move;

import java.time.ZonedDateTime;
import java.time.ZoneId;

public final class ReminderTimeTest {
    private static int checked;
    private static void check(String label, int[] days, String clock, String now, String expected, String timezone) {
        long actual = ReminderTime.next(days, clock, ZonedDateTime.parse(now).toInstant().toEpochMilli(), ZoneId.of(timezone));
        long target = expected == null ? 0 : ZonedDateTime.parse(expected).toInstant().toEpochMilli();
        if (actual != target) throw new AssertionError(label + ": expected " + target + ", got " + actual);
        checked++;
    }
    public static void main(String[] args) {
        check("same Monday", new int[]{1}, "17:00", "2026-10-19T16:00:00+09:00", "2026-10-19T17:00:00+09:00", "Asia/Chita");
        check("elapsed Monday", new int[]{1}, "17:00", "2026-10-19T17:01:00+09:00", "2026-10-26T17:00:00+09:00", "Asia/Chita");
        check("equal instant is next week", new int[]{1}, "17:00", "2026-10-19T17:00:00+09:00", "2026-10-26T17:00:00+09:00", "Asia/Chita");
        check("ISO Sunday", new int[]{7}, "09:15", "2026-10-17T23:00:00+09:00", "2026-10-18T09:15:00+09:00", "Asia/Chita");
        check("first selected weekday", new int[]{1,3,5}, "18:30", "2026-10-20T10:00:00+09:00", "2026-10-21T18:30:00+09:00", "Asia/Chita");
        check("midnight crosses month", new int[]{7}, "00:00", "2026-10-31T23:00:00+09:00", "2026-11-01T00:00:00+09:00", "Asia/Chita");
        check("DST missing hour", new int[]{7}, "02:30", "2026-03-08T00:00:00-05:00", "2026-03-08T03:30:00-04:00", "America/New_York");
        check("DST repeated hour first occurrence", new int[]{7}, "01:30", "2026-11-01T00:00:00-04:00", "2026-11-01T01:30:00-04:00", "America/New_York");
        check("DST repeated hour never twice", new int[]{7}, "01:30", "2026-11-01T01:45:00-04:00", "2026-11-08T01:30:00-05:00", "America/New_York");
        check("device zone affects local day", new int[]{7}, "08:00", "2026-10-17T23:30:00Z", "2026-10-25T08:00:00+09:00", "Asia/Chita");
        check("off no days", new int[]{}, "17:00", "2026-10-19T16:00:00Z", null, "UTC");
        check("invalid clock", new int[]{1}, "25:00", "2026-10-19T16:00:00Z", null, "UTC");
        int[] everyDay = {1,2,3,4,5,6,7};
        check("daily morning before seven", everyDay, "07:00", "2026-10-18T06:59:00+09:00", "2026-10-18T07:00:00+09:00", "Asia/Chita");
        check("daily morning after seven", everyDay, "07:00", "2026-10-18T07:01:00+09:00", "2026-10-19T07:00:00+09:00", "Asia/Chita");
        check("daily morning crosses year", everyDay, "07:00", "2026-12-31T23:59:00+03:00", "2027-01-01T07:00:00+03:00", "Europe/Moscow");
        if(ReminderTime.nextTraining(java.time.OffsetDateTime.parse("2026-11-06T06:00:00+09:00").toInstant().toEpochMilli(),ZoneId.of("Asia/Chita")) != java.time.OffsetDateTime.parse("2026-11-06T07:00:00+09:00").toInstant().toEpochMilli()) throw new AssertionError("training schedule 2026-11-06T06:00:00+09:00"); checked++;
        if(ReminderTime.nextTraining(java.time.OffsetDateTime.parse("2026-11-06T08:00:00+09:00").toInstant().toEpochMilli(),ZoneId.of("Asia/Chita")) != java.time.OffsetDateTime.parse("2026-11-06T19:00:00+09:00").toInstant().toEpochMilli()) throw new AssertionError("training schedule 2026-11-06T08:00:00+09:00"); checked++;
        if(ReminderTime.nextTraining(java.time.OffsetDateTime.parse("2026-11-07T08:00:00+09:00").toInstant().toEpochMilli(),ZoneId.of("Asia/Chita")) != java.time.OffsetDateTime.parse("2026-11-07T14:00:00+09:00").toInstant().toEpochMilli()) throw new AssertionError("training schedule 2026-11-07T08:00:00+09:00"); checked++;
        if(ReminderTime.nextTraining(java.time.OffsetDateTime.parse("2026-11-07T14:00:00+09:00").toInstant().toEpochMilli(),ZoneId.of("Asia/Chita")) != java.time.OffsetDateTime.parse("2026-11-07T19:00:00+09:00").toInstant().toEpochMilli()) throw new AssertionError("training schedule 2026-11-07T14:00:00+09:00"); checked++;
        if(ReminderTime.nextTraining(java.time.OffsetDateTime.parse("2026-11-08T08:00:00+09:00").toInstant().toEpochMilli(),ZoneId.of("Asia/Chita")) != java.time.OffsetDateTime.parse("2026-11-08T14:00:00+09:00").toInstant().toEpochMilli()) throw new AssertionError("training schedule 2026-11-08T08:00:00+09:00"); checked++;
        if(ReminderTime.nextTraining(java.time.OffsetDateTime.parse("2026-11-08T20:00:00+09:00").toInstant().toEpochMilli(),ZoneId.of("Asia/Chita")) != java.time.OffsetDateTime.parse("2026-11-09T07:00:00+09:00").toInstant().toEpochMilli()) throw new AssertionError("training schedule 2026-11-08T20:00:00+09:00"); checked++;
        System.out.println("ReminderTime: " + checked + " assertions passed");
    }
}
