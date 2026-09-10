package com.example.stable.domain;

/** Domain entity used to give the class map realistic fan-in. */
public class AuditEntry {
    private String action;
    private String actor;

    public String getAction() {
        return action;
    }

    public String getActor() {
        return actor;
    }
}
