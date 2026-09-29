package journey.pricing;

public class FlatPricing extends Pricing {
    @Override
    public int price(int seats) { return seats * 10; }

    public static String describe() { return "flat"; }
}
