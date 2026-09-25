package journey.service;

public class MailNotifier implements Notifier {
    @Override
    public void send(String email) {
        send(email, "Welcome");
    }

    @Override
    public void send(String email, String subject) {
    }
}
