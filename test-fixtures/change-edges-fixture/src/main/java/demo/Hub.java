package demo;

public class Hub {
    private final Dep dep = new Dep();
    private final Peer peer = new Peer();

    public void handle() {
        dep.load();
        String cached = "warm";
        dep.load();
        dep.save(cached);
        peer.ping(this);
    }

    public void pong() {
        dep.save("pong");
    }
}
