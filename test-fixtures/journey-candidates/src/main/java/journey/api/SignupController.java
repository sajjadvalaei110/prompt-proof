package journey.api;

import journey.dto.SignupRequest;
import journey.service.Formatter;
import journey.service.SignupService;

public class SignupController {
    private final SignupService signupService;
    private final Formatter formatter;

    public SignupController(SignupService signupService, Formatter formatter) {
        this.signupService = signupService;
        this.formatter = formatter;
    }

    /** The only call has a record-accessor argument, so the symbol solver cannot type it. */
    public void register(String eventId, SignupRequest request) {
        signupService.register(eventId, request.email());
    }

    /** Two in-source overloads take one argument: ambiguous. */
    public String label(SignupRequest request) {
        return formatter.format(request.email());
    }
}
