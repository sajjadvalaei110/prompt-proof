package journey.pricing;

/** An in-source type whose getMessage() the symbol solver resolves to the JDK: that call stays UNRESOLVED. */
public class PricingError extends RuntimeException {
    public PricingError(String message) { super(message); }
}
