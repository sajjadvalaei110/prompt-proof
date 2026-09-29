package journey.service;

import com.unknown.UnknownLib;
import java.time.LocalDateTime;
import journey.domain.Event;
import journey.dto.Receipt;

public class SignupService {
    private final EventStore store;
    private final Notifier notifier;

    public SignupService(EventStore store, Notifier notifier) {
        this.store = store;
        this.notifier = notifier;
    }

    public Receipt register(String eventId, String email) {
        Event event = store.findById(eventId).orElseThrow();
        event.getParticipants();
        store.save(event);
        notifier.send(email);
        LocalDateTime.now();
        UnknownLib.helper();
        return new Receipt(email);
    }

    public void register(String eventId) {
    }
}
