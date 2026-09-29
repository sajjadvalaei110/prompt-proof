package journey.pricing;

public class TieredPricing extends Pricing {
    @Override
    public int price(int seats) { return seats > 10 ? seats * 8 : seats * 10; }
}
