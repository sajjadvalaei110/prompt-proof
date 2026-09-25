package journey.service;

public interface Notifier {
    void send(String email);
    void send(String email, String subject);
}
