package demo;

public class Caller {
    private final Hub hub = new Hub();

    public void run() {
        hub.handle();
    }
}
