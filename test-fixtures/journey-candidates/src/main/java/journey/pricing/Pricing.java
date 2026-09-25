package journey.pricing;

public abstract class Pricing {
    public abstract int price(int seats);

    public int price(int seats, int discount) {
        return price(seats) - discount;
    }

    public static String describe() { return "pricing"; }
}
