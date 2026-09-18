# Xtream web playback compatibility

## Scope

Initial prerequisite check for the ServiceHub live TV/VOD player, using the
dedicated account supplied through workspace secrets. No customer account was
selected, and no credential values, provider hosts, stream URLs, or catalogue
titles are recorded here.

These results describe samples from one provider, not every service or stream.

## Confirmed

- The supplied HTTPS base endpoint accepted the test login.
- The API reported the account as active and advertised `m3u8` and `ts` output.
- Live catalogue retrieval returned HTTP 200 and 40,829 entries.
- VOD catalogue retrieval returned HTTP 200 and 35,038 entries.
- API catalogue responses advertised wildcard CORS.
- The VOD catalogue included MP4, MKV, AVI, and TS container extensions.
  A container extension alone does not establish codec/browser compatibility.

## Blocking delivery findings

- One sampled live HLS URL returned HTTP 302 with an HTTP destination.
- One sampled MP4 VOD URL returned HTTP 302 with an HTTP destination.
- Both redirect responses advertised wildcard CORS, but CORS does not make
  insecure media safe or reliably playable inside an HTTPS application.
- Redirects to HTTP were not followed; credentials were not transmitted over
  HTTP by the checks.

## Not verified

- Final media response headers, final-origin CORS, manifests, segment/key URLs,
  codecs, range/seek support, or actual live/VOD playback.
- Physical iPhone Safari/PWA, Android, or desktop playback.
- Provider playback authorization terms and support for short-lived media tokens.
- Other channels, VOD items, products, or providers.

No successful playback is claimed. The catalogues were real API responses;
there is no mock player presented as working.

## Decision needed before implementation

Preferred: obtain a provider-supported HTTPS playback endpoint that remains
HTTPS through redirects, HLS playlists, segments, keys, and VOD delivery.
Re-run compatibility checks against that endpoint.

Alternative: scope a separate authenticated HTTPS media relay with explicit
bandwidth, capacity, operational, and credential-security requirements. Do not
put bulk video traffic on the existing support/billing server by default.
A relay can address browser mixed-content/CORS restrictions but does not fix
unsupported codecs or DRM. An HTTP upstream would still expose media and
credential-bearing requests on the relay-to-provider connection; a relay does
not make that hop encrypted.

The full player implementation remains pending this decision. No product
settings, customer records, application routes, or deployments were changed by
the compatibility check.