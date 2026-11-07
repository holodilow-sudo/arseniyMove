package ru.arseniy.move;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Deterministic lifecycle tests with a fake TTS service. No audible/device claim. */
public final class SpeechControllerTest {
    private static int checks;
    static void check(boolean okay, String message) {
        if (!okay) throw new AssertionError(message);
        checks++;
    }
    static final class Clock implements SpeechController.Scheduler {
        long now;
        static final class Task { final Runnable run; final long at; Task(Runnable run, long at) { this.run=run; this.at=at; } }
        final List<Task> tasks = new ArrayList<>();
        public long now() { return now; }
        public void post(Runnable task) { later(task, 0); }
        public void later(Runnable task,long delay) { tasks.add(new Task(task,now+delay)); }
        public void cancel(Runnable task) { tasks.removeIf(item -> item.run == task); }
        void drain() {
            for (;;) {
                Task next = null;
                for (Task task : tasks) if (task.at <= now && (next == null || task.at < next.at)) next = task;
                if (next == null) return;
                tasks.remove(next); next.run.run();
            }
        }
        void advance(long delay) { now += delay; drain(); }
    }
    static final class FakeEngine implements SpeechController.Engine {
        final SpeechController.InitCallback init;
        final SpeechController.ErrorCallback error;
        final List<String> spoken = new ArrayList<>(), ids = new ArrayList<>();
        int configured, stops, shutdowns;
        boolean hasRussian = true, acceptsSpeech = true;
        FakeEngine(SpeechController.InitCallback init,SpeechController.ErrorCallback error) { this.init=init;this.error=error; }
        public boolean configureRussian() { configured++;return hasRussian; }
        public boolean speak(String text,String id) { spoken.add(text);ids.add(id);return acceptsSpeech; }
        public void stop() { stops++; }
        public void shutdown() { shutdowns++; }
    }
    static final class Harness implements SpeechController.Feedback {
        final Clock clock = new Clock();
        final List<FakeEngine> engines = new ArrayList<>();
        final List<SpeechController.Status> statuses = new ArrayList<>();
        boolean trusted = true;
        final SpeechController controller = new SpeechController(clock,(init,error) -> {
            FakeEngine engine = new FakeEngine(init,error);engines.add(engine);return engine;
        },this);
        public boolean trusted() { return trusted; }
        public void status(SpeechController.Status value) { statuses.add(value); }
        FakeEngine engine() { return engines.get(engines.size()-1); }
        void ready() { engine().init.complete(true);clock.drain(); }
    }
    public static void main(String[] args) {
        Harness h = new Harness();
        check(h.engines.isEmpty(),"Construction must not start the speech service");
        check("idle".equals(h.controller.status().state),"Initial capability is untested/idle");
        h.controller.prepare();
        check("initializing".equals(h.controller.status().state),"Explicit prepare starts initialization");
        h.controller.prepare();
        check(h.engines.size()==1,"Duplicate prepare must not create two engines");
        h.ready();
        check(h.controller.status().available && h.engine().spoken.isEmpty(),"Preparation does not speak a surprise phrase");
        h.controller.speak("  Один.  ");
        check(h.engine().spoken.equals(Collections.singletonList("Один.")),"A ready engine receives normalized short Russian speech");
        h.controller.speak("Два");
        String oldId=h.engine().ids.get(0),latestId=h.engine().ids.get(1);
        check(!oldId.equals(latestId),"Each utterance has its own cancellation identity");
        h.engine().error.error(oldId);h.clock.drain();
        check(h.controller.status().available,"Error from a flushed older number is ignored");
        h.engine().error.error(latestId);h.clock.drain();
        check("unavailable".equals(h.controller.status().state) && h.engine().shutdowns==1,"Current synthesis error is reported and engine released");

        h=new Harness();h.controller.speak("Один");h.clock.advance(300);h.controller.speak("Два");h.ready();
        check(h.engine().spoken.equals(Collections.singletonList("Два")),"Initialization keeps only the latest number");
        h=new Harness();h.controller.speak("Один");h.clock.advance(2001);h.ready();
        check(h.engine().spoken.isEmpty() && h.controller.status().available,"Late initialization must drop a number older than 2 seconds");
        h=new Harness();h.controller.speak("Один");h.clock.advance(2000);h.ready();
        check(h.engine().spoken.size()==1,"A fresh pending number at the expiry boundary can speak");

        h=new Harness();h.controller.speak(SpeechController.VOICE_TEST_TEXT);h.clock.advance(3000);h.ready();
        check(h.engine().spoken.equals(Collections.singletonList(SpeechController.VOICE_TEST_TEXT)),"Explicit voice test remains audible after a 3-second cold init");
        h=new Harness();h.controller.speak("Один");h.clock.advance(3000);h.ready();
        check(h.engine().spoken.isEmpty(),"Ordinary count remains expired after the same cold init");
        h=new Harness();h.controller.speak(SpeechController.VOICE_TEST_TEXT);h.controller.speak("Два");h.clock.advance(3000);h.ready();
        check(h.engine().spoken.isEmpty(),"Replacing the test with a count does not extend count freshness or replay the old test");
        h=new Harness();h.controller.speak("Два");h.controller.speak(SpeechController.VOICE_TEST_TEXT);h.clock.advance(3000);h.ready();
        check(h.engine().spoken.equals(Collections.singletonList(SpeechController.VOICE_TEST_TEXT)),"Only the latest explicit test survives cold initialization");
        h=new Harness();h.controller.speak(SpeechController.VOICE_TEST_TEXT);FakeEngine cancelledTest=h.engine();h.controller.stop();h.clock.advance(3000);cancelledTest.init.complete(true);h.clock.drain();
        check(cancelledTest.spoken.isEmpty() && cancelledTest.shutdowns==1,"Stop still cancels a pending long-lived test phrase");
        h=new Harness();h.controller.speak(SpeechController.VOICE_TEST_TEXT);h.clock.advance(8000);h.ready();
        check(h.engine().spoken.isEmpty() && "unavailable".equals(h.controller.status().state),"Explicit test cannot outlive initialization timeout");

        h=new Harness();h.controller.speak("Один");FakeEngine cancelled=h.engine();h.controller.stop();
        check(cancelled.shutdowns==1 && cancelled.stops==1,"Stop releases an initializing engine");
        cancelled.init.complete(true);h.clock.advance(9000);
        check(cancelled.configured==0 && cancelled.spoken.isEmpty() && "idle".equals(h.controller.status().state),"Late init and timeout after stop cannot speak or report failure");
        h.controller.speak("Два");FakeEngine replacement=h.engine();cancelled.init.complete(true);h.clock.drain();
        check(replacement.configured==0,"Old initialization cannot configure the replacement engine");
        h.ready();check(replacement.spoken.equals(Collections.singletonList("Два")),"Replacement speaks only the new session request");

        h=new Harness();h.controller.prepare();h.clock.advance(8000);FakeEngine timeout=h.engine();
        check("unavailable".equals(h.controller.status().state) && timeout.shutdowns==1,"Stalled initialization has a bounded timeout");
        timeout.init.complete(true);h.clock.drain();
        check(timeout.configured==0,"Success after timeout cannot resurrect a service");
        h=new Harness();h.controller.speak("Один");h.engine().init.complete(false);h.clock.drain();
        check(h.engine().configured==0 && !h.controller.status().available,"Init failure cannot attempt synthesis");

        h=new Harness();h.controller.prepare();h.engine().hasRussian=false;h.ready();
        check("unavailable".equals(h.controller.status().state) && h.controller.status().message.contains("русский"),"Missing offline Russian has useful feedback");
        h.controller.speak("Два");h.controller.speak("Три");
        check(h.engines.size()==1,"Missing voice cannot cause a retry for each repetition");
        h.controller.prepare();h.ready();
        check(h.engines.size()==2 && h.controller.status().available,"Explicit voice test permits retry after installing a voice");
        h.engine().acceptsSpeech=false;h.controller.speak("Четыре");
        check("unavailable".equals(h.controller.status().state),"Synchronous speak failure reaches the status callback");

        h=new Harness();h.trusted=false;h.controller.prepare();h.controller.speak("Один");
        check(h.engines.isEmpty() && h.statuses.isEmpty(),"Untrusted/background documents cannot initialize or speak");
        h.trusted=true;h.controller.speak("Один");h.trusted=false;h.ready();
        check(h.engine().shutdowns==1 && h.engine().spoken.isEmpty(),"Losing foreground before init cancels pending speech");
        h=new Harness();h.controller.prepare();h.ready();h.controller.speak("Один");FakeEngine warm=h.engine();String stoppedId=warm.ids.get(0);h.controller.stop();
        check(warm.stops==1 && warm.shutdowns==0,"Stopping ready speech flushes it without unnecessary reinitialization");
        warm.error.error(stoppedId);h.clock.drain();
        check(h.controller.status().available,"Error from stopped speech is ignored");
        h.trusted=false;h.controller.speak("Два");check(warm.spoken.size()==1,"No sound starts in background");
        h.trusted=true;h.controller.prepare();h.controller.speak("Три");
        check(h.engines.size()==1 && warm.spoken.get(1).equals("Три"),"Explicit resumed request can reuse ready local voice");
        h.controller.resetForSettings();
        check(warm.shutdowns==1 && "idle".equals(h.controller.status().state),"Settings action releases cached voice selection");
        h.controller.prepare();h.ready();check(h.engines.size()==2,"After settings the next explicit request rechecks installed voices");
        h.controller.destroy();h.controller.prepare();h.controller.speak("Пять");
        check(h.engines.size()==2 && h.engine().shutdowns==1,"Destroyed controller cannot restart or retain TTS");
        h=new Harness();h.controller.speak("Один");FakeEngine destroyed=h.engine();h.controller.destroy();destroyed.init.complete(true);h.clock.drain();
        check(destroyed.shutdowns==1 && destroyed.spoken.isEmpty(),"Destroy cancels asynchronous initialization");

        Set<String> installed=Collections.emptySet(),missing=new HashSet<>();missing.add("notInstalled");
        check(SpeechController.eligibleVoice(new Locale("ru","RU"),false,installed),"Installed offline Russian voice is eligible");
        check(SpeechController.eligibleVoice(new Locale("ru"),false,installed),"Installed generic Russian voice is eligible");
        check(!SpeechController.eligibleVoice(Locale.ENGLISH,false,installed),"English fallback is not Russian speech");
        check(!SpeechController.eligibleVoice(new Locale("ru"),true,installed),"Network Russian voice is excluded");
        check(!SpeechController.eligibleVoice(new Locale("ru"),false,missing),"Not-installed voice must never be selected/downloaded implicitly");
        check(!SpeechController.eligibleVoice(new Locale("ru"),false,null),"Unknown feature state is not assumed installed");
        check(!SpeechController.eligibleVoice(null,false,installed),"Unknown voice locale is rejected");
        check("10 секунд".equals(SpeechController.normalize("10 секунд")),"Numbers and Russian counter labels are supported");
        for(String invalid : new String[]{null,"","   ","<speak>Раз</speak>","Hello","Один\nДва",String.join("",Collections.nCopies(121,"я"))})
            check(SpeechController.normalize(invalid)==null,"Unsupported/oversized text is rejected");
        System.out.println("SpeechController: PASS "+checks+" checks; fake engine only, no physical/audio validation");
    }
}
