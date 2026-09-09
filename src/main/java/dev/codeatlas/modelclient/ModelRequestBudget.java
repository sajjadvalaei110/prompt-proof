package dev.codeatlas.modelclient;

/**
 * Provider-neutral token estimate, not a tokenizer or a claim about model capacity.
 * ASCII is estimated at three characters/token; non-ASCII uses its UTF-8 byte bound.
 * A margin covers message framing and tokenizer variance. Provider rejection remains authoritative.
 */
public record ModelRequestBudget(int contextTokens, int outputTokens) {
    public ModelRequestBudget {
        if (contextTokens < 1024 || outputTokens < 128 || (long) outputTokens + 512 >= contextTokens)
            throw new IllegalArgumentException("Set a model context window of at least 1024 tokens and an output limit of at least 128 tokens, leaving at least 512 tokens for input.");
    }

    public int inputTokens(int output) {
        return Math.max(0, (int)((contextTokens - (long)output - 128) / 1.15));
    }

    public boolean fits(String system, String user, int output) {
        return estimate(system) + (long)estimate(user) <= inputTokens(output);
    }

    public static int estimate(String text) {
        long ascii = 0, other = 0;
        for (int i = 0; i < text.length();) {
            int point = text.codePointAt(i);
            if (point < 128) ascii++;
            else other += point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
            i += Character.charCount(point);
        }
        return (int)Math.min(Integer.MAX_VALUE, (ascii + 2) / 3 + other);
    }

    /** Largest prefix within an estimated token budget; never bisects a surrogate pair. */
    public static String prefix(String text, int tokens) {
        if (tokens <= 0) return "";
        long ascii = 0, other = 0;
        int end = 0;
        while (end < text.length()) {
            int point = text.codePointAt(end);
            if (point < 128) ascii++;
            else other += point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
            if ((ascii + 2) / 3 + other > tokens) break;
            end += Character.charCount(point);
        }
        return text.substring(0, end);
    }
}
