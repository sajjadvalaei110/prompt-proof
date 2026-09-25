package journey.service;

import journey.domain.Event;
import org.springframework.data.repository.CrudRepository;

public interface EventStore extends CrudRepository<Event, String> {
}
