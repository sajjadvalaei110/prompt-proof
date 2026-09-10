package com.example.stable.external;

import com.example.stable.service.SearchService;
import com.acme.search.SearchBase;
import com.acme.search.SearchCredentials;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * SearchBase and SearchCredentials are outside the indexed source, so those
 * relationships stay unresolved while the in-source collaborator resolves.
 */
@Component
public class ExternalSearchClient extends SearchBase {
    @Autowired
    private SearchCredentials credentials;

    @Autowired
    private SearchService searchService;

    public String describe() {
        return "ExternalSearchClient";
    }
}
