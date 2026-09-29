package journey.pricing;

import com.unknown.LibraryCoupon;
import journey.dto.SignupRequest;

public class Coupon extends LibraryCoupon {
    private int apply(String code) { return code.length(); }

    /** Its own private method is visible here: the unique name/arity match. */
    int total(SignupRequest request) { return apply(request.email()); }
}
