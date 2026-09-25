package journey.pricing;

import journey.dto.SignupRequest;

public class SeasonalCoupon extends Coupon {
    /** apply(int) comes from the library supertype; Coupon's private apply(String) is not visible here. */
    int use(SignupRequest request) { return apply(request.seats()); }
}
