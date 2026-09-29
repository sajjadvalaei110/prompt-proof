package journey.pricing;

import journey.dto.SignupRequest;

public class Checkout {
    private final Pricing pricing;
    private final FlatPricing flat;

    public Checkout(Pricing pricing, FlatPricing flat) {
        this.pricing = pricing;
        this.flat = flat;
    }

    /** Found on the supertype: one in-source method takes two arguments. */
    public int total(SignupRequest request) {
        return pricing.price(request.seats(), 1);
    }

    /** FlatPricing.price(int) overrides Pricing.price(int): one signature, the nearest declaration wins. */
    public int flatTotal(SignupRequest request) {
        return flat.price(request.seats());
    }

    /** Resolved by the symbol solver to Throwable.getMessage(): known to be external, so never a candidate. */
    public String describe(PricingError error) {
        return error.getMessage();
    }
}
