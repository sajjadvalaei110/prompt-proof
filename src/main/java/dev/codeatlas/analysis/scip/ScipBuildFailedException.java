package dev.codeatlas.analysis.scip;

/**
 * The target build failed while scip-java indexed it (ADR 0012).
 *
 * <p>{@link #getMessage()} names the build and the failure only. The tail of the build output — which can contain
 * credentials, environment details or source text — is carried separately in {@link #buildOutputTail()} and is never
 * part of the message, so logging this exception (message and stack trace) never copies build output into the
 * application log. Callers show the tail to the user as display data (the job's error message), not in logs.</p>
 */
public class ScipBuildFailedException extends IllegalStateException {

    private final transient String buildOutputTail;

    public ScipBuildFailedException(String message, String buildOutputTail) {
        super(message);
        this.buildOutputTail = buildOutputTail == null ? "" : buildOutputTail;
    }

    /** The last lines of the build output, for display to the user only; never log it. */
    public String buildOutputTail() {
        return buildOutputTail;
    }
}
