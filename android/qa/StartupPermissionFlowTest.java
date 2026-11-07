package ru.arseniy.move;

/** Runs the actual launch policy without a device; does not simulate camera access. */
public final class StartupPermissionFlowTest {
    private static int checks;
    private static void expect(boolean value, String label) {
        checks++;
        if (!value) throw new AssertionError(label);
    }
    private static MainActivity.StartupPermissionFlow fresh() { return new MainActivity.StartupPermissionFlow(); }
    public static void main(String[] args) {
        MainActivity.StartupPermissionFlow fresh = fresh();
        expect(fresh.offer(true, true), "fresh install offers both missing permissions");
        expect(!fresh.offer(true, true), "pageFinished/onResume do not duplicate offer");
        expect(fresh.next(true, false, true, true, false) == 0, "no system requests before Continue");
        fresh.begin();
        expect(fresh.next(true, false, true, true, false) == 1, "camera is first");
        expect(fresh.active, "flow stays active while camera dialog is showing");
        expect(fresh.next(false, false, true, true, false) == 2, "notifications follow camera grant");
        expect(fresh.next(false, false, false, false, false) == 0, "both grants finish");
        expect(!fresh.active, "camera handoff may finish after notification dialog");

        MainActivity.StartupPermissionFlow denied = fresh();
        denied.offer(true, true); denied.begin();
        expect(denied.next(true, false, true, true, false) == 1, "camera requested once");
        expect(denied.next(true, false, true, true, false) == 2, "camera denial does not prevent notification request");
        expect(denied.next(true, false, true, true, false) == 0, "two denials do not cause immediate prompt loop");
        expect(!denied.offer(true, true), "denial does not duplicate offer in same launch");
        expect(fresh().offer(true, true), "next launch offers missing permissions again, no persisted suppression");

        MainActivity.StartupPermissionFlow blocked = fresh();
        blocked.offer(true, true); blocked.begin();
        expect(blocked.next(true, true, true, true, false) == 2, "camera permanently denied: still ask notifications");
        expect(blocked.next(true, true, false, false, false) == 3, "permanent camera denial routes to settings");
        expect(blocked.next(true, true, false, false, false) == 0, "settings offered once, never loops");

        MainActivity.StartupPermissionFlow oldAndroid = fresh();
        oldAndroid.offer(true, false); oldAndroid.begin();
        expect(oldAndroid.next(true, false, false, false, false) == 1, "Android 8-12 only camera runtime prompt");
        expect(oldAndroid.next(false, false, false, false, false) == 0, "no unsupported notification permission prompt");
        MainActivity.StartupPermissionFlow blockedChannel = fresh();
        blockedChannel.offer(false, true); blockedChannel.begin();
        expect(blockedChannel.next(false, false, true, false, false) == 3, "disabled notification channel opens settings");

        MainActivity.StartupPermissionFlow allowed = fresh();
        expect(!allowed.offer(false, false), "granted permissions need no repeated prompt");
        MainActivity.StartupPermissionFlow noCamera = fresh();
        noCamera.offer(false, true); noCamera.begin();
        expect(noCamera.next(false, false, true, true, false) == 2, "notification-only devices do not request absent camera");
        MainActivity.StartupPermissionFlow permanentNotification = fresh();
        permanentNotification.offer(false, true); permanentNotification.begin();
        expect(permanentNotification.next(false, false, true, true, true) == 3, "permanent notification denial uses settings");
        System.out.println("PASS " + checks + " launch-permission policy checks; no device or real camera tested");
    }
}
